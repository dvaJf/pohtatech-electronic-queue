import os
import uuid
import logging
from typing import Dict, Any, Optional, List
import httpx

logger = logging.getLogger("rag_agent.tools")

def get_backend_url() -> str:
    url = os.getenv("BACKEND_URL")
    if url:
        return url.rstrip("/")
    return "http://127.0.0.1:8080"

class BackendClient:
    def __init__(self, base_url: Optional[str] = None):
        self._custom_url = base_url

    @property
    def base_url(self) -> str:
        return self._custom_url or get_backend_url()

    async def _request(self, method: str, path: str, **kwargs) -> Optional[httpx.Response]:
        urls = [self.base_url]
        if "backend" in self.base_url:
            urls.append("http://127.0.0.1:8080")
        for u in urls:
            try:
                full_url = f"{u}{path}"
                async with httpx.AsyncClient(timeout=kwargs.pop("timeout", 4.0)) as client:
                    resp = await client.request(method, full_url, **kwargs)
                    return resp
            except Exception as e:
                logger.debug(f"Request failed to {u}{path}: {e}")
        return None

    async def list_branches(self) -> List[Dict[str, Any]]:
        """Fetch all postal branches."""
        resp = await self._request("GET", "/api/v1/branches")
        if resp and resp.status_code == 200:
            return resp.json().get("items", [])
        return []

    async def list_services(self, branch_id: str) -> List[Dict[str, Any]]:
        """Fetch available services for a branch with automatic fallback."""
        if branch_id:
            resp = await self._request("GET", f"/api/v1/branches/{branch_id}/services")
            if resp and resp.status_code == 200:
                items = resp.json().get("items", [])
                if items:
                    return items
        # Fallback to demo branch if specified branch has no services
        demo_resp = await self._request("GET", "/api/v1/branches/11111111-1111-1111-1111-111111111111/services")
        if demo_resp and demo_resp.status_code == 200:
            items = demo_resp.json().get("items", [])
            if items:
                return items
        return [
            {"id": "22222222-2222-2222-2222-222222222222", "code": "PARCELS", "name": "Посылки"},
            {"id": "33333333-2222-2222-2222-222222222222", "code": "SEND", "name": "Письма и мелкие пакеты"},
            {"id": "55555555-5555-5555-5555-555555555555", "code": "PAYMENTS", "name": "Платежи и переводы"},
            {"id": "44444444-2222-2222-2222-222222222222", "code": "RETAIL", "name": "Розничные товары и услуги"},
        ]

    async def get_ticket_details(self, ticket_id: str) -> Optional[Dict[str, Any]]:
        """Fetch ticket information, current position, and ETA."""
        if not ticket_id:
            return None

        result: Dict[str, Any] = {"ticket_id": ticket_id}
        resp = await self._request("GET", f"/api/v1/tickets/{ticket_id}")
        if resp and resp.status_code == 200:
            result["ticket"] = resp.json()
        else:
            return None

        pos_resp = await self._request("GET", f"/api/v1/tickets/{ticket_id}/position")
        if pos_resp and pos_resp.status_code == 200:
            result["position"] = pos_resp.json()

        eta_resp = await self._request("GET", f"/api/v1/tickets/{ticket_id}/eta")
        if eta_resp and eta_resp.status_code == 200:
            result["eta"] = eta_resp.json()

        return result

    async def create_live_ticket(self, branch_id: str, service_id: str) -> Optional[Dict[str, Any]]:
        """Create a live queue ticket with automatic fallback."""
        target_branch = branch_id or "11111111-1111-1111-1111-111111111111"
        headers = {
            "Idempotency-Key": str(uuid.uuid4()),
            "Content-Type": "application/json"
        }
        body = {"serviceId": service_id}
        resp = await self._request("POST", f"/api/v1/branches/{target_branch}/tickets/live", json=body, headers=headers)
        if resp and resp.status_code in (200, 201):
            return resp.json()
        if target_branch != "11111111-1111-1111-1111-111111111111":
            resp2 = await self._request("POST", "/api/v1/branches/11111111-1111-1111-1111-111111111111/tickets/live", json=body, headers=headers)
            if resp2 and resp2.status_code in (200, 201):
                return resp2.json()
        return None

    async def create_appointment(
        self,
        branch_id: str,
        service_id: str,
        scheduled_at: str,
        phone: Optional[str] = None,
        email: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Book an appointment for a specific time."""
        headers = {
            "Idempotency-Key": str(uuid.uuid4()),
            "Content-Type": "application/json"
        }
        body = {
            "branchId": branch_id,
            "serviceId": service_id,
            "scheduledAt": scheduled_at,
            "phone": phone or "",
            "email": email or ""
        }
        resp = await self._request("POST", f"/api/v1/branches/{branch_id}/tickets/appointment", json=body, headers=headers)
        if resp and resp.status_code in (200, 201):
            data = resp.json()
            if "ticket" in data and isinstance(data["ticket"], dict):
                t = dict(data["ticket"])
                if "scheduledAt" in data and "scheduledAt" not in t:
                    t["scheduledAt"] = data["scheduledAt"]
                if "managementToken" in data and "managementToken" not in t:
                    t["managementToken"] = data["managementToken"]
                return t
            return data
        return None

    async def get_branch_workload(self, branch_id: str) -> Optional[Dict[str, Any]]:
        """Fetch workload and waiting times for a branch."""
        resp = await self._request("GET", f"/api/v1/branches/{branch_id}/workload")
        if resp and resp.status_code == 200:
            return resp.json()
        return None

# Singleton client instance
backend_client = BackendClient()
