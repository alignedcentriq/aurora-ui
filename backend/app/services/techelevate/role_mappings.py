"""
Proxy for the real TechElevate role-mappings endpoints (admin only).

Confirmed real paths:
  GET    /role-mappings
  POST   /role-mappings          {email, role}
  PUT    /role-mappings/{id}     {role}
  DELETE /role-mappings/{id}
"""

from . import _client as c


def list_role_mappings(token: str) -> list:
    return c.get(token, "/role-mappings")


def create_role_mapping(token: str, *, email: str, role: str) -> dict:
    return c.post(token, "/role-mappings", json={"email": email, "role": role})


def update_role_mapping(token: str, mapping_id: int, *, role: str) -> dict:
    return c.put(token, f"/role-mappings/{mapping_id}", json={"role": role})


def delete_role_mapping(token: str, mapping_id: int) -> None:
    return c.delete(token, f"/role-mappings/{mapping_id}")
