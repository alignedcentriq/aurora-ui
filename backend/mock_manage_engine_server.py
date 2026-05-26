"""
Mock ManageEngine Endpoint Central API Server
-----------------------------------------------
Mimics the Endpoint Central REST API used by ManageEngineService.
Runs in-memory — no real devices are contacted.

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
from fastapi import FastAPI, Request, HTTPException, Query
from fastapi.responses import JSONResponse

app = FastAPI(title="Mock ManageEngine Endpoint Central", version="1.4")

# ── Seed Data ────────────────────────────────────────────────────────────────

# Pre-seeded devices: hostname → device info
_DEVICES: dict[str, dict] = {
    "DESKTOP-AA001": {"resource_id": "1001", "computer_name": "DESKTOP-AA001", "os_name": "Windows 11 Pro", "domain": "alignedautomation.local"},
    "DESKTOP-AA002": {"resource_id": "1002", "computer_name": "DESKTOP-AA002", "os_name": "Windows 11 Pro", "domain": "alignedautomation.local"},
    "DESKTOP-AA003": {"resource_id": "1003", "computer_name": "DESKTOP-AA003", "os_name": "Windows 10 Pro", "domain": "alignedautomation.local"},
    "LAPTOP-AA004":  {"resource_id": "1004", "computer_name": "LAPTOP-AA004",  "os_name": "Windows 11 Pro", "domain": "alignedautomation.local"},
    "LAPTOP-AA005":  {"resource_id": "1005", "computer_name": "LAPTOP-AA005",  "os_name": "Windows 11 Home", "domain": "alignedautomation.local"},
    "TEST-MACHINE":  {"resource_id": "9999", "computer_name": "TEST-MACHINE",  "os_name": "Windows 11 Pro", "domain": "alignedautomation.local"},
}

# Pre-seeded software packages: package_id → package info
_PACKAGES: dict[str, dict] = {
    "PKG-001": {"package_id": "PKG-001", "package_name": "Visual Studio Code", "version": "1.88.0"},
    "PKG-002": {"package_id": "PKG-002", "package_name": "Notepad++", "version": "8.6.4"},
    "PKG-003": {"package_id": "PKG-003", "package_name": "Google Chrome", "version": "124.0"},
    "PKG-004": {"package_id": "PKG-004", "package_name": "Mozilla Firefox", "version": "125.0"},
    "PKG-005": {"package_id": "PKG-005", "package_name": "7-Zip", "version": "24.05"},
    "PKG-006": {"package_id": "PKG-006", "package_name": "Python 3.12", "version": "3.12.3"},
    "PKG-007": {"package_id": "PKG-007", "package_name": "Git", "version": "2.45.0"},
    "PKG-008": {"package_id": "PKG-008", "package_name": "Postman", "version": "10.24"},
    "PKG-009": {"package_id": "PKG-009", "package_name": "DBeaver Community", "version": "24.0"},
    "PKG-010": {"package_id": "PKG-010", "package_name": "WinRAR", "version": "7.00"},
}

# In-memory deployment jobs: job_id → job state
_JOBS: dict[str, dict] = {}

# ── Auth check ───────────────────────────────────────────────────────────────

def _check_auth(request: Request) -> None:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Apitoken "):
        raise HTTPException(status_code=401, detail="Missing or invalid API token")


# ── Computers (Device Lookup) ────────────────────────────────────────────────

@app.get("/api/1.4/som/computers")
async def list_computers(request: Request, searchValue: str = Query(default="")):
    """
    GET /api/1.4/som/computers?searchValue={hostname}
    Returns matching devices.
    """
    _check_auth(request)

    results = []
    for hostname, device in _DEVICES.items():
        if not searchValue or searchValue.lower() in hostname.lower():
            results.append(device)

    return JSONResponse({
        "message_response": {
            "status": "success",
            "computers": {
                "computer_detail": results,
                "total": len(results),
            }
        }
    })


# ── Software Deployment ───────────────────────────────────────────────────────

@app.post("/api/1.4/som/softwaredeployment")
async def create_deployment(request: Request):
    """
    POST /api/1.4/som/softwaredeployment
    Body: { "package_id": "PKG-001", "resource_id": "1001", "deploy_type": "Install" }
    Returns a job_id.
    """
    _check_auth(request)

    body = await request.json()
    package_id = body.get("package_id", "")
    resource_id = body.get("resource_id", "")

    if not package_id or not resource_id:
        raise HTTPException(status_code=400, detail="package_id and resource_id are required")

    # Verify package and device exist
    if package_id not in _PACKAGES:
        raise HTTPException(status_code=404, detail=f"Package {package_id} not found")

    device = next((d for d in _DEVICES.values() if d["resource_id"] == resource_id), None)
    if not device:
        raise HTTPException(status_code=404, detail=f"Device {resource_id} not found")

    job_id = f"JOB-{uuid.uuid4().hex[:8].upper()}"
    _JOBS[job_id] = {
        "job_id": job_id,
        "package_id": package_id,
        "package_name": _PACKAGES[package_id]["package_name"],
        "resource_id": resource_id,
        "computer_name": device["computer_name"],
        "status": "InProgress",
        "status_detail": "Deployment initiated",
        "created_at": time.time(),
        "completed_at": None,
        "error": None,
    }

    # Auto-complete after 10 seconds in background
    asyncio.create_task(_auto_complete_job(job_id, delay=10))

    return JSONResponse({
        "message_response": {
            "status": "success",
            "job_id": job_id,
            "message": f"Deployment job {job_id} created successfully",
        }
    }, status_code=201)


@app.get("/api/1.4/som/softwaredeployment/{job_id}")
async def get_deployment_status(job_id: str, request: Request):
    """
    GET /api/1.4/som/softwaredeployment/{job_id}
    Returns deployment job status.
    """
    _check_auth(request)

    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    return JSONResponse({
        "message_response": {
            "status": "success",
            "deployment": job,
        }
    })


# ── Script Execution (fallback) ───────────────────────────────────────────────

@app.post("/api/1.4/som/scripts/execute")
async def execute_script(request: Request):
    """
    POST /api/1.4/som/scripts/execute
    Body: { "resource_id": "1001", "script_content": "..." }
    Fallback for custom installs.
    """
    _check_auth(request)

    body = await request.json()
    resource_id = body.get("resource_id", "")

    device = next((d for d in _DEVICES.values() if d["resource_id"] == resource_id), None)
    if not device:
        raise HTTPException(status_code=404, detail=f"Device {resource_id} not found")

    job_id = f"SCRIPT-{uuid.uuid4().hex[:8].upper()}"
    _JOBS[job_id] = {
        "job_id": job_id,
        "package_id": None,
        "package_name": "Custom Script",
        "resource_id": resource_id,
        "computer_name": device["computer_name"],
        "status": "InProgress",
        "status_detail": "Script execution initiated",
        "created_at": time.time(),
        "completed_at": None,
        "error": None,
    }

    asyncio.create_task(_auto_complete_job(job_id, delay=5))

    return JSONResponse({
        "message_response": {
            "status": "success",
            "job_id": job_id,
            "message": f"Script job {job_id} created",
        }
    }, status_code=201)


# ── Internal helpers ─────────────────────────────────────────────────────────

async def _auto_complete_job(job_id: str, delay: int = 10) -> None:
    """Simulate deployment completing after `delay` seconds."""
    await asyncio.sleep(delay)
    if job_id in _JOBS:
        _JOBS[job_id]["status"] = "Completed"
        _JOBS[job_id]["status_detail"] = "Software installed successfully"
        _JOBS[job_id]["completed_at"] = time.time()


# ── Admin / Debug endpoints ───────────────────────────────────────────────────

@app.get("/admin/devices")
async def list_all_devices():
    """Debug: list all seeded devices."""
    return JSONResponse({"devices": list(_DEVICES.values())})


@app.get("/admin/packages")
async def list_all_packages():
    """Debug: list all seeded packages."""
    return JSONResponse({"packages": list(_PACKAGES.values())})


@app.get("/admin/jobs")
async def list_all_jobs():
    """Debug: list all in-memory jobs."""
    return JSONResponse({"jobs": list(_JOBS.values())})


@app.post("/admin/devices")
async def add_device(request: Request):
    """Debug: add a device. Body: {hostname, resource_id, os_name}"""
    body = await request.json()
    hostname = body.get("hostname", "").upper()
    if not hostname:
        raise HTTPException(status_code=400, detail="hostname required")
    _DEVICES[hostname] = {
        "resource_id": body.get("resource_id", str(len(_DEVICES) + 1000)),
        "computer_name": hostname,
        "os_name": body.get("os_name", "Windows 11 Pro"),
        "domain": body.get("domain", "alignedautomation.local"),
    }
    return JSONResponse({"status": "added", "device": _DEVICES[hostname]})


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/")
async def health():
    return {
        "status": "ok",
        "service": "Mock ManageEngine Endpoint Central",
        "port": 8091,
        "devices": len(_DEVICES),
        "packages": len(_PACKAGES),
        "jobs": len(_JOBS),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8091)
