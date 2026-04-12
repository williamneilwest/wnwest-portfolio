import os
import json
import logging
import threading
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request, send_from_directory, make_response
import mimetypes
from typing import Optional

# Reuse helpers from email uploads where possible to keep behavior consistent
from .email_upload import clean_filename, extract_original_name
from ..services.document_parser import run_document_processing_task, parse_document
from ..services.document_ai import analyze_document
from ..models.reference import AIDocument, SessionLocal, init_db
from ..utils.storage import get_kb_category_dir, get_kb_dir


kb_bp = Blueprint("kb", __name__)
LOGGER = logging.getLogger(__name__)

# Common office/document/image types for KB intake (allow-list, minimal)
ALLOWED_KB_EXTENSIONS = {
    ".pdf", ".txt",
    ".doc", ".docx",
    ".ppt", ".pptx",
    ".xls", ".xlsx",
    ".png", ".jpg", ".jpeg", ".gif", ".webp"
}


def _kb_category_dir(category: str) -> str:
    cat = (category or "").strip().lower() or "uncategorized"
    safe = clean_filename(cat) or "uncategorized"
    return get_kb_category_dir(safe)


def _kb_metadata_path(category: str, filename: str) -> str:
    return os.path.join(_kb_category_dir(category), f"{filename}.meta.json")


def _kb_write_metadata(category: str, filename: str, payload: dict):
    try:
        with open(_kb_metadata_path(category, filename), "w", encoding="utf-8") as h:
            json.dump(payload or {}, h)
    except OSError:
        pass


def _determine_category(original_name: str, mail_subject=None) -> str:
    # Simple heuristic: prefer subject first token, else filename first token
    def first_token(value: str) -> str:
        if not value:
            return ""
        v = value.strip()
        # split on common separators
        for sep in [" - ", "_", "-", " "]:
            if sep in v:
                return v.split(sep)[0]
        return v

    subject_token = first_token(mail_subject or "")
    filename_token = first_token(original_name or "")
    token = subject_token or filename_token or "uncategorized"
    # Clean and lower for directory safety/consistency
    return (clean_filename(token) or "uncategorized").lower()


def _derive_tags(category: str, original_name: str, mail_subject: Optional[str]) -> list[str]:
    """Lightweight tag extraction for quick reference.

    - Seeds with the category
    - Adds keywords from filename (sans timestamp/extension)
    - Adds up to 5 short keywords from the email subject
    """
    tags = set()

    def norm(word: str) -> str:
        w = (word or "").strip().lower()
        return clean_filename(w)

    cat = norm(category)
    if cat:
        tags.add(cat)

    base = (original_name or "").rsplit(".", 1)[0]
    for token in [t for t in base.replace("-", " ").replace("_", " ").split(" ") if t]:
        n = norm(token)
        if 2 <= len(n) <= 20:
            tags.add(n)

    subj = (mail_subject or "")
    count = 0
    for token in [t for t in subj.replace("-", " ").replace("_", " ").split(" ") if t]:
        n = norm(token)
        if 2 <= len(n) <= 20:
            tags.add(n)
            count += 1
            if count >= 5:
                break

    # Remove empty strings just in case
    return [t for t in sorted(tags) if t]


def _build_kb_url(category: str, filename: str) -> str:
    safe_cat = (clean_filename(category) or "uncategorized").lower()
    return f"/kb/{safe_cat}/{filename}"


def _queue_document_processing(app, path: str):
    worker = threading.Thread(
        target=run_document_processing_task,
        args=(app, path),
        daemon=True,
    )
    worker.start()


@kb_bp.route("/webhooks/kb", methods=["POST"])
def handle_kb_email():
    """Accept email attachments for Knowledge Base ingestion.

    Expected to be called by the mail provider webhook (similar to /webhooks/mailgun).
    Files will be saved under BACKEND_DATA_DIR/kb/<category>/timestamp_cleanedname.ext
    Category is determined via a light heuristic from subject or filename.
    """
    saved = []

    mail_subject = (request.form.get("subject") or "").strip()

    for file in request.files.values():
        original_name = (file.filename or "").strip()
        if not original_name:
            continue

        cleaned = clean_filename(original_name)
        if not cleaned:
            continue

        # Enforce a small allow-list for KB document types
        ext = os.path.splitext(cleaned)[1].lower()
        if ext and (ext not in ALLOWED_KB_EXTENSIONS):
            continue

        category = _determine_category(original_name, mail_subject)
        directory = _kb_category_dir(category)

        timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        safe_name = f"{timestamp}_{cleaned}"
        path = os.path.join(directory, safe_name)

        try:
            file.save(path)
            _kb_write_metadata(
                category,
                safe_name,
                {
                    "source": "email",
                    "category": category,
                    "originalName": original_name,
                    "subject": mail_subject,
                    "tags": _derive_tags(category, original_name, mail_subject),
                },
            )
            print(f"[kb] Saved KB doc: {path} (category={category})")
            _queue_document_processing(current_app._get_current_object(), path)
            saved.append({
                "category": category,
                "filename": safe_name,
                "url": _build_kb_url(category, safe_name),
            })
        except OSError:
            continue

    if not saved:
        return jsonify({"success": False, "message": "No valid attachments"}), 400

    return jsonify({"success": True, "saved": saved})


@kb_bp.route("/kb", methods=["GET"])  # back-compat style
@kb_bp.route("/api/kb", methods=["GET"])  # preferred API path
def list_kb():
    categories = []
    # Optional filter: ?q=tag or comma-separated tags
    q = (request.args.get("q") or request.args.get("tag") or "").strip().lower()
    q_tags = [t for t in {p.strip().lower() for p in q.split(",")} if t]

    try:
        cat_names = sorted(os.listdir(get_kb_dir()))
    except OSError:
        cat_names = []

    for cat in cat_names:
        if cat == 'processed':
            continue

        cat_dir = os.path.join(get_kb_dir(), cat)
        if not os.path.isdir(cat_dir):
            continue

        items = []
        try:
            names = os.listdir(cat_dir)
        except OSError:
            names = []

        for name in names:
            if name.endswith('.meta.json'):
                continue
            full_path = os.path.join(cat_dir, name)
            if not os.path.isfile(full_path):
                continue

            try:
                modified_ts = os.path.getmtime(full_path)
            except OSError:
                modified_ts = 0

            # Metadata and enrichment
            meta_path = _kb_metadata_path(cat, name)
            metadata = {}
            try:
                if os.path.exists(meta_path):
                    with open(meta_path, "r", encoding="utf-8") as mh:
                        md = json.load(mh)
                        if isinstance(md, dict):
                            metadata = md
            except (OSError, json.JSONDecodeError):
                metadata = {}

            original_name = metadata.get("originalName") or extract_original_name(name)
            subject = metadata.get("subject")
            tags = metadata.get("tags")
            if not isinstance(tags, list):
                tags = _derive_tags(cat, original_name, subject)

            # Optional filtering by tags
            if q_tags and not any((t or "").lower() in q_tags for t in tags):
                continue

            mime, _ = mimetypes.guess_type(name)
            size = None
            try:
                size = os.path.getsize(full_path)
            except OSError:
                pass

            items.append({
                "filename": name,
                "originalName": original_name,
                "url": _build_kb_url(cat, name),
                "modifiedAt": datetime.fromtimestamp(modified_ts, tz=timezone.utc).isoformat() if modified_ts else None,
                "mimeType": mime or "application/octet-stream",
                "size": size,
                "source": metadata.get("source") or "email",
                "tags": tags,
            })

        # newest first within category
        items.sort(key=lambda x: (x["modifiedAt"] or ""), reverse=True)

        categories.append({
            "category": cat,
            "files": items,
        })

    # sort categories by name for stability
    categories.sort(key=lambda x: x["category"]) 

    return jsonify({"categories": categories})


@kb_bp.route("/kb/<path:category>/<path:filename>", methods=["GET"])
@kb_bp.route("/api/kb/<path:category>/<path:filename>", methods=["GET"])  # alias
def get_kb_file(category, filename):
    # Serve with an inline disposition to favor in-browser viewing/printing where supported
    directory = _kb_category_dir(category)
    path = os.path.join(directory, filename)
    mime, _ = mimetypes.guess_type(filename)

    response = make_response(send_from_directory(directory, filename, mimetype=mime or None))
    disp_name = filename.replace('"', "")
    response.headers["Content-Disposition"] = f"inline; filename=\"{disp_name}\""
    if mime:
        response.headers["Content-Type"] = mime
    return response


@kb_bp.post('/api/kb/analyze')
def analyze_kb_document():
    """Analyze a KB document using the AI Gateway/OpenAI via existing AI route.

    Request JSON: { "category": string, "filename": string }
    Response: Stored AIDocument payload identical to /api/documents/analyze
    """
    # Ensure DB is initialized (idempotent)
    try:
        init_db()
    except Exception:
        pass

    payload = request.get_json(silent=True) or {}
    category = str(payload.get('category') or '').strip()
    filename = str(payload.get('filename') or '').strip()

    if not category or not filename:
        return jsonify({'error': 'category and filename are required.'}), 400

    directory = _kb_category_dir(category)
    file_path = os.path.join(directory, filename)

    if not os.path.isfile(file_path):
        return jsonify({'error': 'KB document not found.'}), 404

    # Extract text from the document
    extracted = parse_document(file_path) or {}
    text = str(extracted.get('text') or '')

    # Run AI analysis through the existing /api/ai/chat flow (gateway-aware)
    ai_result = None
    try:
        ai_result = analyze_document(text, filename)
    except Exception as error:
        LOGGER.warning('AI analysis failed for KB %s/%s: %s', category, filename, error)

    tags = []
    ai_summary = ''
    structured = {}
    if ai_result:
        ai_summary = str(ai_result.get('summary') or '').strip()
        tags = ai_result.get('tags') if isinstance(ai_result.get('tags'), list) else []
        structured = {key: value for key, value in ai_result.items() if key != 'tags'}

    # Persist/update AIDocument record
    session = SessionLocal()
    try:
        existing = session.query(AIDocument).filter(AIDocument.original_path == file_path).one_or_none()
        if existing is None:
            mime, _ = mimetypes.guess_type(filename)
            existing = AIDocument(
                filename=filename,
                original_path=file_path,
                file_type=mime or os.path.splitext(filename)[1].lower().lstrip('.'),
                source='kb',
            )
            session.add(existing)

        mime, _ = mimetypes.guess_type(filename)
        existing.filename = filename
        existing.file_type = mime or os.path.splitext(filename)[1].lower().lstrip('.')
        existing.source = 'kb'
        existing.parsed_text = text
        existing.ai_summary = ai_summary
        existing.ai_structured = json.dumps(structured, ensure_ascii=False)
        existing.tags = json.dumps(sorted({str(tag or '').strip().lower() for tag in tags if str(tag or '').strip()}), ensure_ascii=False)
        existing.updated_at = datetime.now(timezone.utc)
        if existing.created_at is None:
            existing.created_at = datetime.now(timezone.utc)

        session.commit()
        session.refresh(existing)
        # Mirror documents.py serialization
        try:
            structured_doc = json.loads(existing.ai_structured or '{}') if existing.ai_structured else {}
        except json.JSONDecodeError:
            structured_doc = {}
        try:
            tag_list = json.loads(existing.tags or '[]') if existing.tags else []
        except json.JSONDecodeError:
            tag_list = []

        return jsonify({
            'id': existing.id,
            'filename': existing.filename,
            'original_path': existing.original_path,
            'file_type': existing.file_type or '',
            'source': existing.source or '',
            'parsed_text': existing.parsed_text or '',
            'ai_summary': existing.ai_summary or '',
            'ai_structured': structured_doc if isinstance(structured_doc, dict) else {},
            'tags': tag_list if isinstance(tag_list, list) else [],
            'created_at': existing.created_at.isoformat() if existing.created_at else None,
            'updated_at': existing.updated_at.isoformat() if existing.updated_at else None,
        })
    finally:
        session.close()
