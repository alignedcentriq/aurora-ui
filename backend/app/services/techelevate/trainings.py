"""
Proxy for the real TechElevate trainings / training-levels / exam-settings endpoints.

Confirmed real paths (from the downloaded backend source):
  GET    /trainings                          list (paginated)
  GET    /trainings/stats
  GET    /trainings/{id}
  POST   /trainings
  PUT    /trainings/{id}
  DELETE /trainings/{id}
  POST   /trainings/{id}/photo
  GET    /training-levels/{id}
  PUT    /training-levels/{id}
  POST   /training-levels/{id}/video
  GET    /training-levels/{id}/exam-settings
  PUT    /training-levels/{id}/exam-settings
  GET    /trainings/{id}/exam-settings
  PUT    /trainings/{id}/exam-settings
"""

from . import _client as c


def list_trainings(token: str, *, skip: int = 0, limit: int = 100, search: str | None = None) -> dict:
    params = {"skip": skip, "limit": limit}
    if search:
        params["search"] = search
    return c.get(token, "/trainings", params=params)


def get_training_stats(token: str) -> dict:
    return c.get(token, "/trainings/stats")


def get_training(token: str, training_id: int) -> dict:
    return c.get(token, f"/trainings/{training_id}")


def create_training(token: str, payload: dict) -> dict:
    """POST /trainings is multipart/form-data on the real API (title/description/category/
    has_levels/levels[as JSON string]/owner_id/instructor_ids[as JSON string], optional file).
    `payload` uses normal Python types; this builds the form the real endpoint expects."""
    import json as _json

    form: dict = {
        "title": payload["title"],
        "has_levels": "true" if payload.get("levels") else "false",
    }
    if payload.get("description"):
        form["description"] = payload["description"]
    if payload.get("category"):
        form["category"] = payload["category"]
    if payload.get("owner_id"):
        form["owner_id"] = payload["owner_id"]
    if payload.get("instructor_ids"):
        form["instructor_ids"] = _json.dumps(payload["instructor_ids"])
    if payload.get("levels"):
        form["levels"] = _json.dumps(payload["levels"])
    elif payload.get("training_details"):
        form["training_details"] = _json.dumps(payload["training_details"])
    return c.post(token, "/trainings", data=form)


def update_training(token: str, training_id: int, payload: dict) -> dict:
    return c.put(token, f"/trainings/{training_id}", json=payload)


def delete_training(token: str, training_id: int) -> None:
    return c.delete(token, f"/trainings/{training_id}")


def upload_training_photo(token: str, training_id: int, filename: str, content: bytes, content_type: str) -> dict:
    return c.post(token, f"/trainings/{training_id}/photo",
                  files={"file": (filename, content, content_type)})


def get_training_level(token: str, level_id: int) -> dict:
    return c.get(token, f"/training-levels/{level_id}")


def update_training_level(token: str, level_id: int, payload: dict) -> dict:
    return c.put(token, f"/training-levels/{level_id}", json=payload)


def upload_level_video(token: str, level_id: int, filename: str, content: bytes, content_type: str) -> dict:
    return c.post(token, f"/training-levels/{level_id}/video",
                  files={"file": (filename, content, content_type)})


def get_level_exam_settings(token: str, level_id: int) -> dict:
    return c.get(token, f"/training-levels/{level_id}/exam-settings")


def update_level_exam_settings(token: str, level_id: int, payload: dict) -> dict:
    return c.put(token, f"/training-levels/{level_id}/exam-settings", json=payload)


def get_training_exam_settings(token: str, training_id: int) -> dict:
    return c.get(token, f"/trainings/{training_id}/exam-settings")


def update_training_exam_settings(token: str, training_id: int, payload: dict) -> dict:
    return c.put(token, f"/trainings/{training_id}/exam-settings", json=payload)
