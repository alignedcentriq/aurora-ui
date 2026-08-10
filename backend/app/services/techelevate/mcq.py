"""
Proxy for the real TechElevate MCQ question-authoring endpoints (the question BANK —
not the exam-attempt flow, which is intentionally not proxied).

Confirmed real paths:
  GET    /mcq-questions?skip&limit&search&training_level_id&is_active&sort_by&sort_order
  POST   /mcq-questions                     admin/instructor — {training_level_id, question_text,
                                             option_a..d, correct_option, explanation, marks}
  PUT    /mcq-questions/{id}
  DELETE /mcq-questions/{id}
  PUT    /mcq-questions/{id}/toggle
  GET    /certificates                      caller's own earned certificates
"""

from . import _client as c


def list_questions(token: str, *, training_level_id: int, skip: int = 0, limit: int = 200,
                   is_active: bool | None = None) -> dict:
    params: dict = {"skip": skip, "limit": limit, "training_level_id": training_level_id}
    if is_active is not None:
        params["is_active"] = is_active
    return c.get(token, "/mcq-questions", params=params)


def create_question(token: str, payload: dict) -> dict:
    return c.post(token, "/mcq-questions", json=payload)


def update_question(token: str, question_id: int, payload: dict) -> dict:
    return c.put(token, f"/mcq-questions/{question_id}", json=payload)


def delete_question(token: str, question_id: int) -> None:
    return c.delete(token, f"/mcq-questions/{question_id}")


def toggle_question(token: str, question_id: int) -> dict:
    return c.put(token, f"/mcq-questions/{question_id}/toggle")


def get_my_certificates(token: str) -> list:
    return c.get(token, "/certificates")
