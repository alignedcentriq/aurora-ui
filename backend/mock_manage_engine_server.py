"""
Mock ManageEngine Endpoint Central API Server
-----------------------------------------------
Mimics the Endpoint Central REST API used by ManageEngineService.
Runs in-memory — no real devices are contacted.

Swagger UI: http://localhost:8091/docs
ReDoc:       http://localhost:8091/redoc

Auth: All /api/* endpoints require header:
    Authorization: Apitoken mock-api-key

Usage:
    cd backend
    uvicorn mock_manage_engine_server:app --port 8091

Then set in .env.local:
    MANAGE_ENGINE_BASE_URL=http://localhost:8091
    MANAGE_ENGINE_API_KEY=mock-api-key
"""

import asyncio
import uuid
import time
from fastapi import FastAPI, HTTPException, Query, Security
from fastapi.security import APIKeyHeader
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional

app = FastAPI(
    title="Mock ManageEngine Endpoint Central",
    version="1.4",
    description=(
        "Mimics ManageEngine Endpoint Central REST API for local development.\n\n"
        "**Authentication**: Click **Authorize** and enter `mock-api-key`.\n\n"
        "All `/api/*` endpoints require the header: `Authorization: Apitoken <key>`"
    ),
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── Security scheme ───────────────────────────────────────────────────────────

_api_key_header = APIKeyHeader(name="Authorization", scheme_name="ApiToken", auto_error=False)


def _check_auth(api_key: str = Security(_api_key_header)) -> None:
    if not api_key or not api_key.startswith("Apitoken "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid API token. Use: Authorization: Apitoken <key>",
        )


# ── Seed Data ────────────────────────────────────────────────────────────────

_DEVICES: dict[str, dict] = {
    "DESKTOP-AA001": {"resource_id": "1001", "computer_name": "DESKTOP-AA001", "os_name": "Windows 11 Pro",  "domain": "alignedautomation.local"},
    "DESKTOP-AA002": {"resource_id": "1002", "computer_name": "DESKTOP-AA002", "os_name": "Windows 11 Pro",  "domain": "alignedautomation.local"},
    "DESKTOP-AA003": {"resource_id": "1003", "computer_name": "DESKTOP-AA003", "os_name": "Windows 10 Pro",  "domain": "alignedautomation.local"},
    "LAPTOP-AA004":  {"resource_id": "1004", "computer_name": "LAPTOP-AA004",  "os_name": "Windows 11 Pro",  "domain": "alignedautomation.local"},
    "LAPTOP-AA005":  {"resource_id": "1005", "computer_name": "LAPTOP-AA005",  "os_name": "Windows 11 Home", "domain": "alignedautomation.local"},
    "TEST-MACHINE":  {"resource_id": "9999", "computer_name": "TEST-MACHINE",  "os_name": "Windows 11 Pro",  "domain": "alignedautomation.local"},
}

_PACKAGES: dict[str, dict] = {
    "PKG-001": {"package_id": "PKG-001", "package_name": "Visual Studio Code", "version": "1.88.0"},
    "PKG-002": {"package_id": "PKG-002", "package_name": "Notepad++",          "version": "8.6.4"},
    "PKG-003": {"package_id": "PKG-003", "package_name": "Google Chrome",      "version": "124.0"},
    "PKG-004": {"package_id": "PKG-004", "package_name": "Mozilla Firefox",    "version": "125.0"},
    "PKG-005": {"package_id": "PKG-005", "package_name": "7-Zip",              "version": "24.05"},
    "PKG-006": {"package_id": "PKG-006", "package_name": "Python 3.12",        "version": "3.12.3"},
    "PKG-007": {"package_id": "PKG-007", "package_name": "Git",                "version": "2.45.0"},
    "PKG-008": {"package_id": "PKG-008", "package_name": "Postman",            "version": "10.24"},
    "PKG-009": {"package_id": "PKG-009", "package_name": "DBeaver Community",  "version": "24.0"},
    "PKG-010": {"package_id": "PKG-010", "package_name": "WinRAR",             "version": "7.00"},
}

_JOBS: dict[str, dict] = {}


# ── Request / Response Models ────────────────────────────────────────────────

class DeploymentRequest(BaseModel):
    package_id: str = Field(..., description="Package ID (e.g. PKG-001)", example="PKG-001")
    resource_id: str = Field(..., description="Device resource ID (e.g. 1001)", example="1001")
    deploy_type: str = Field(default="Install", description="Deploy action", example="Install")

    model_config = {
        "json_schema_extra": {
            "example": {"package_id": "PKG-001", "resource_id": "1001", "deploy_type": "Install"}
        }
    }


class ScriptRequest(BaseModel):
    resource_id: str = Field(..., description="Target device resource ID", example="1001")
    script_content: str = Field(..., description="PowerShell or shell script content", example="Write-Host 'Hello'")

    model_config = {
        "json_schema_extra": {
            "example": {"resource_id": "1001", "script_content": "Write-Host 'Hello'"}
        }
    }


class AddDeviceRequest(BaseModel):
    hostname: str = Field(..., description="Device hostname (uppercased)", example="LAPTOP-AA099")
    resource_id: str = Field(default="", description="Optional resource ID; auto-assigned if blank", example="1099")
    os_name: str = Field(default="Windows 11 Pro", example="Windows 11 Pro")
    domain: str = Field(default="alignedautomation.local", example="alignedautomation.local")

    model_config = {
        "json_schema_extra": {
            "example": {"hostname": "LAPTOP-AA099", "resource_id": "1099", "os_name": "Windows 11 Pro", "domain": "alignedautomation.local"}
        }
    }


class HealthResponse(BaseModel):
    status: str
    service: str
    port: int
    devices: int
    packages: int
    jobs: int


# ── Internal helpers ─────────────────────────────────────────────────────────

async def _auto_complete_job(job_id: str, delay: int = 10) -> None:
    """Simulate deployment completing after `delay` seconds."""
    await asyncio.sleep(delay)
    if job_id in _JOBS:
        _JOBS[job_id]["status"] = "Completed"
        _JOBS[job_id]["status_detail"] = "Software installed successfully"
        _JOBS[job_id]["completed_at"] = time.time()


# ── Computers (Device Lookup) ────────────────────────────────────────────────

@app.get(
    "/api/1.4/som/computers",
    summary="List / search devices",
    tags=["Computers"],
    dependencies=[Security(_api_key_header)],
)
async def list_computers(
    searchValue: str = Query(default="", description="Partial hostname to filter by. Leave blank to list all."),
    _auth: str = Security(_api_key_header),
):
    """
    Returns devices matching `searchValue`. Leave blank to return all seeded devices.

    **Auth header**: `Authorization: Apitoken mock-api-key`
    """
    _check_auth(_auth)
    results = [
        device for hostname, device in _DEVICES.items()
        if not searchValue or searchValue.lower() in hostname.lower()
    ]
    return JSONResponse({
        "message_response": {
            "status": "success",
            "computers": {"computer_detail": results, "total": len(results)},
        }
    })


# ── Software Deployment ───────────────────────────────────────────────────────

@app.post(
    "/api/1.4/som/softwaredeployment",
    summary="Create deployment job",
    tags=["Deployment"],
    status_code=201,
)
async def create_deployment(body: DeploymentRequest, _auth: str = Security(_api_key_header)):
    """
    Creates a software deployment job. The job auto-completes after **10 seconds**.

    Check the returned `job_id` via `GET /api/1.4/som/softwaredeployment/{job_id}`.

    **Auth header**: `Authorization: Apitoken mock-api-key`

    **Valid package IDs**: PKG-001 … PKG-010 (see `/admin/packages`)

    **Valid resource IDs**: 1001–1005, 9999 (see `/admin/devices`)
    """
    _check_auth(_auth)

    if body.package_id not in _PACKAGES:
        raise HTTPException(status_code=404, detail=f"Package {body.package_id} not found. Use /admin/packages to list valid IDs.")

    device = next((d for d in _DEVICES.values() if d["resource_id"] == body.resource_id), None)
    if not device:
        raise HTTPException(status_code=404, detail=f"Device {body.resource_id} not found. Use /admin/devices to list valid IDs.")

    job_id = f"JOB-{uuid.uuid4().hex[:8].upper()}"
    _JOBS[job_id] = {
        "job_id": job_id,
        "package_id": body.package_id,
        "package_name": _PACKAGES[body.package_id]["package_name"],
        "resource_id": body.resource_id,
        "computer_name": device["computer_name"],
        "status": "InProgress",
        "status_detail": "Deployment initiated",
        "created_at": time.time(),
        "completed_at": None,
        "error": None,
    }
    asyncio.create_task(_auto_complete_job(job_id, delay=10))

    return JSONResponse({
        "message_response": {
            "status": "success",
            "job_id": job_id,
            "message": f"Deployment job {job_id} created. It will auto-complete in ~10 seconds.",
        }
    }, status_code=201)


@app.get(
    "/api/1.4/som/softwaredeployment/{job_id}",
    summary="Get deployment job status",
    tags=["Deployment"],
)
async def get_deployment_status(job_id: str, _auth: str = Security(_api_key_header)):
    """
    Returns the current status of a deployment job.

    `status` will be `InProgress` then switch to `Completed` after ~10 seconds.

    **Auth header**: `Authorization: Apitoken mock-api-key`
    """
    _check_auth(_auth)
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")
    return JSONResponse({"message_response": {"status": "success", "deployment": job}})


# ── Script Execution ──────────────────────────────────────────────────────────

@app.post(
    "/api/1.4/som/scripts/execute",
    summary="Execute script on device",
    tags=["Scripts"],
    status_code=201,
)
async def execute_script(body: ScriptRequest, _auth: str = Security(_api_key_header)):
    """
    Executes a custom script on a target device. Auto-completes after **5 seconds**.

    **Auth header**: `Authorization: Apitoken mock-api-key`

    **Valid resource IDs**: 1001–1005, 9999 (see `/admin/devices`)
    """
    _check_auth(_auth)
    device = next((d for d in _DEVICES.values() if d["resource_id"] == body.resource_id), None)
    if not device:
        raise HTTPException(status_code=404, detail=f"Device {body.resource_id} not found.")

    job_id = f"SCRIPT-{uuid.uuid4().hex[:8].upper()}"
    _JOBS[job_id] = {
        "job_id": job_id,
        "package_id": None,
        "package_name": "Custom Script",
        "resource_id": body.resource_id,
        "computer_name": device["computer_name"],
        "status": "InProgress",
        "status_detail": "Script execution initiated",
        "created_at": time.time(),
        "completed_at": None,
        "error": None,
    }
    asyncio.create_task(_auto_complete_job(job_id, delay=5))

    return JSONResponse({
        "message_response": {"status": "success", "job_id": job_id, "message": f"Script job {job_id} created."}
    }, status_code=201)


# ── Admin / Debug endpoints ───────────────────────────────────────────────────

@app.get("/admin/devices", summary="List all seeded devices", tags=["Admin"])
async def list_all_devices():
    """No auth required. Returns all pre-seeded devices."""
    return JSONResponse({"devices": list(_DEVICES.values())})


@app.get("/admin/packages", summary="List all seeded packages", tags=["Admin"])
async def list_all_packages():
    """No auth required. Returns all pre-seeded software packages."""
    return JSONResponse({"packages": list(_PACKAGES.values())})


@app.get("/admin/jobs", summary="List all in-memory jobs", tags=["Admin"])
async def list_all_jobs():
    """No auth required. Returns all deployment and script jobs created this session."""
    return JSONResponse({"jobs": list(_JOBS.values())})


@app.post("/admin/devices", summary="Add a device", tags=["Admin"])
async def add_device(body: AddDeviceRequest):
    """
    No auth required. Adds a device to the in-memory seed data for the current session.
    """
    hostname = body.hostname.upper()
    _DEVICES[hostname] = {
        "resource_id": body.resource_id or str(len(_DEVICES) + 1000),
        "computer_name": hostname,
        "os_name": body.os_name,
        "domain": body.domain,
    }
    return JSONResponse({"status": "added", "device": _DEVICES[hostname]})


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/", response_model=HealthResponse, summary="Health check", tags=["System"])
async def health():
    """Returns server status and seed data counts."""
    return HealthResponse(
        status="ok",
        service="Mock ManageEngine Endpoint Central",
        port=8091,
        devices=len(_DEVICES),
        packages=len(_PACKAGES),
        jobs=len(_JOBS),
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8091)
