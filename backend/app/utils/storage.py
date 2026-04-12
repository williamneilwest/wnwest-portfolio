import os

from flask import current_app


def get_backend_data_dir() -> str:
    base_dir = current_app.config.get("BACKEND_DATA_DIR", "/app/data")
    os.makedirs(base_dir, exist_ok=True)
    return base_dir


def get_uploads_dir() -> str:
    base_dir = current_app.config.get("BACKEND_DATA_DIR", "/app/data")
    uploads_dir = os.path.join(base_dir, "uploads")
    os.makedirs(uploads_dir, exist_ok=True)
    return uploads_dir


def get_kb_dir() -> str:
    # Store KB files under the work namespace to keep them alongside other work data
    # New location: <BACKEND_DATA_DIR>/work/kb (previously <BACKEND_DATA_DIR>/kb)
    kb_dir = os.path.join(get_backend_data_dir(), "work", "kb")
    os.makedirs(kb_dir, exist_ok=True)
    return kb_dir


def get_kb_category_dir(category: str) -> str:
    cat = (category or "").strip().lower() or "uncategorized"
    kb_dir = get_kb_dir()
    category_dir = os.path.join(kb_dir, cat)
    os.makedirs(category_dir, exist_ok=True)
    return category_dir
