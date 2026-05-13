"""In-memory PDF store for generated documents."""

from typing import Optional


_store: dict[str, dict] = {}


def store_pdf(file_id: str, data: bytes, filename: str) -> None:
    _store[file_id] = {"data": data, "filename": filename}


def get_pdf(file_id: str) -> Optional[dict]:
    return _store.get(file_id)
