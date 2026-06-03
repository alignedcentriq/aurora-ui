"""
ManageEngine Endpoint Central Service
---------------------------------------
Wraps the Endpoint Central REST API (v1.4) for:
  - Device lookup by hostname
  - Software package deployment
  - Deployment job status polling
  - Script execution (fallback)

Points to MANAGE_ENGINE_BASE_URL from config.
Set that to http://localhost:8091 during development (mock server).
"""

import logging
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger("aurora-logger")

_TIMEOUT = 15.0  # seconds


class ManageEngineError(Exception):
    """Raised when ME API returns an error or the response is unexpected."""


class ManageEngineService:
    def __init__(self):
        self.base_url = settings.MANAGE_ENGINE_BASE_URL.rstrip("/")
        self.api_key = settings.MANAGE_ENGINE_API_KEY
        self._headers = {
            "Authorization": f"Apitoken {self.api_key}",
            "Content-Type": "application/json",
        }

    # ── Device lookup ────────────────────────────────────────────────────────

    async def get_device_by_hostname(self, hostname: str) -> Optional[dict]:
        """
        Look up a managed device by hostname.
        Returns the device dict (resource_id, computer_name, os_name) or None.
        """
        url = f"{self.base_url}/api/1.4/som/computers"
        params = {"searchValue": hostname}
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.get(url, headers=self._headers, params=params)
                resp.raise_for_status()
        except httpx.HTTPError as e:
            raise ManageEngineError(f"Device lookup failed: {e}") from e

        data = resp.json()
        computers = (
            data.get("message_response", {})
                .get("computers", {})
                .get("computer_detail", [])
        )
        if not computers:
            return None

        # Exact match first, then partial
        hostname_lower = hostname.lower()
        for device in computers:
            if device.get("computer_name", "").lower() == hostname_lower:
                return device
        return computers[0]

    # ── Deployment ───────────────────────────────────────────────────────────

    async def deploy_package(self, package_id: str, device_id: str) -> str:
        """
        Trigger a software deployment job.
        Returns the job_id string.
        """
        url = f"{self.base_url}/api/1.4/som/softwaredeployment"
        body = {
            "package_id": package_id,
            "resource_id": device_id,
            "deploy_type": "Install",
        }
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(url, headers=self._headers, json=body)
                resp.raise_for_status()
        except httpx.HTTPError as e:
            raise ManageEngineError(f"Deployment failed: {e}") from e

        data = resp.json()
        job_id = data.get("message_response", {}).get("job_id")
        if not job_id:
            raise ManageEngineError(f"No job_id in response: {data}")
        return job_id

    # ── Status polling ───────────────────────────────────────────────────────

    async def get_deployment_status(self, job_id: str) -> dict:
        """
        Poll a deployment job for its current status.
        Returns the deployment dict with at least: status, status_detail.
        """
        url = f"{self.base_url}/api/1.4/som/softwaredeployment/{job_id}"
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.get(url, headers=self._headers)
                resp.raise_for_status()
        except httpx.HTTPError as e:
            raise ManageEngineError(f"Status poll failed: {e}") from e

        data = resp.json()
        deployment = data.get("message_response", {}).get("deployment")
        if deployment is None:
            raise ManageEngineError(f"No deployment data in response: {data}")
        return deployment

    # ── Script execution ─────────────────────────────────────────────────────

    async def execute_script(self, device_id: str, script_content: str) -> str:
        """
        Execute an arbitrary script on a managed device.
        Returns job_id.
        """
        url = f"{self.base_url}/api/1.4/som/scripts/execute"
        body = {"resource_id": device_id, "script_content": script_content}
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(url, headers=self._headers, json=body)
                resp.raise_for_status()
        except httpx.HTTPError as e:
            raise ManageEngineError(f"Script execution failed: {e}") from e

        data = resp.json()
        job_id = data.get("message_response", {}).get("job_id")
        if not job_id:
            raise ManageEngineError(f"No job_id in script response: {data}")
        return job_id


# Singleton
_service: Optional[ManageEngineService] = None


def get_manage_engine_service() -> ManageEngineService:
    global _service
    if _service is None:
        _service = ManageEngineService()
    return _service
