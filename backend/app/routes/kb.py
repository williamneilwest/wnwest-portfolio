import os
import json
import logging
import re
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request, send_from_directory, make_response
import mimetypes
from typing import Optional

# Reuse helpers from email uploads where possible to keep behavior consistent
from .email_upload import clean_filename, extract_original_name, rotate_stored_file_versions
from ..services.document_parser import parse_document
from ..services.document_ai import analyze_document
from ..services.file_registry import upsert_file_metadata
from ..services.tag_derivation import derive_tags
from ..services.ticket_match import match_ticket_to_kb
from ..models.reference import AIDocument, SessionLocal, init_db
from ..utils.deprecation import log_deprecated_route
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


def _touch_kb_access(category: str, filename: str):
    metadata = _kb_read_metadata(category, filename)
    metadata["lastOpenedAt"] = datetime.now(timezone.utc).isoformat()
    next_access_count = int(metadata.get("access_count") or metadata.get("accessCount") or 0) + 1
    metadata["access_count"] = next_access_count
    metadata["accessCount"] = next_access_count
    _kb_write_metadata(category, filename, metadata)


def _kb_read_metadata(category: str, filename: str) -> dict:
    try:
        with open(_kb_metadata_path(category, filename), "r", encoding="utf-8") as h:
            data = json.load(h)
            return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _kb_write_analysis_metadata(category: str, filename: str, analysis_payload: dict):
    existing = _kb_read_metadata(category, filename)
    merged = dict(existing)
    merged["analysis"] = analysis_payload
    merged["derived_tags_v1"] = _compute_derived_tags_for_metadata(category, filename, merged)
    _kb_write_metadata(category, filename, merged)


def _safe_tag_list(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(tag or "").strip().lower() for tag in value if str(tag or "").strip()]


def _compute_derived_tags_for_metadata(category: str, filename: str, metadata: dict) -> dict:
    original_name = metadata.get("originalName") or extract_original_name(filename)
    source_fields = {
        "category": category,
        "filename": filename,
        "original_name": original_name,
        "subject": metadata.get("subject") or "",
        "summary": (metadata.get("analysis") or {}).get("summary") if isinstance(metadata.get("analysis"), dict) else "",
    }
    return derive_tags(existing_tags=_safe_tag_list(metadata.get("tags")), document_fields=source_fields)


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


def _normalize_version_group_name(filename: str) -> str:
    value = str(filename or '').strip().lower()
    if not value:
        return ''

    # Remove ".old" marker first, then extension.
    value = re.sub(r'\.old$', '', value)
    value = re.sub(r'\.[^.]+$', '', value)
    value = re.sub(r'\s+', ' ', value).strip()
    return value


def _build_structured_payload(ai_result, text, failure_reason=''):
    if isinstance(ai_result, dict):
        structured = {key: value for key, value in ai_result.items() if key != 'tags'}
        if structured:
            return structured

    excerpt = str(text or '').strip()
    if len(excerpt) > 1000:
        excerpt = f'{excerpt[:1000]}\n...'

    return {
        'status': 'analysis_unavailable',
        'reason': failure_reason or 'AI analysis did not return structured output.',
        'text_extracted': bool(str(text or '').strip()),
        'text_excerpt': excerpt,
    }


def _list_kb_categories(q_tags: list[str] | None = None) -> list[dict]:
    categories_map = {}
    q_tags = q_tags or []

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

        grouped_items = {}
        try:
            names = os.listdir(cat_dir)
        except OSError:
            names = []

        for name in names:
            if name.endswith('.meta.json'):
                continue
            if name.lower().endswith('.old'):
                # Never show rotated old versions in listing UI.
                continue
            full_path = os.path.join(cat_dir, name)
            if not os.path.isfile(full_path):
                continue

            try:
                modified_ts = os.path.getmtime(full_path)
            except OSError:
                modified_ts = 0

            metadata = _kb_read_metadata(cat, name)
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

            derived_tags = metadata.get("derived_tags_v1")
            if not isinstance(derived_tags, dict):
                derived_tags = _compute_derived_tags_for_metadata(
                    cat,
                    name,
                    {
                        **metadata,
                        "originalName": original_name,
                        "subject": subject,
                        "tags": tags,
                    },
                )

            resolved_category = str(metadata.get("category") or cat or "uncategorized").strip().lower() or "uncategorized"
            grouping_name = _normalize_version_group_name(original_name or name) or _normalize_version_group_name(name)
            group_key = f'{resolved_category}::{grouping_name}'
            candidate = {
                "filename": name,
                "originalName": original_name,
                "url": _build_kb_url(cat, name),
                "modifiedAt": datetime.fromtimestamp(modified_ts, tz=timezone.utc).isoformat() if modified_ts else None,
                "mimeType": mime or "application/octet-stream",
                "size": size,
                "source": metadata.get("source") or "email",
                "tags": tags,
                "derived_tags": derived_tags,
                "analysis": metadata.get("analysis") if isinstance(metadata.get("analysis"), dict) else None,
                "lastOpenedAt": metadata.get("lastOpenedAt"),
                "access_count": int(metadata.get("access_count") or metadata.get("accessCount") or 0),
                "accessCount": int(metadata.get("access_count") or metadata.get("accessCount") or 0),
                "category": resolved_category,
            }

            existing = grouped_items.get(group_key)
            if existing is None:
                grouped_items[group_key] = candidate
                continue

            existing_modified = str(existing.get("modifiedAt") or "")
            candidate_modified = str(candidate.get("modifiedAt") or "")
            if candidate_modified > existing_modified:
                grouped_items[group_key] = candidate

        for item in grouped_items.values():
            resolved_category = str(item.get("category") or "uncategorized").strip().lower() or "uncategorized"
            categories_map.setdefault(resolved_category, []).append(item)

    categories = []
    for category_name in sorted(categories_map.keys()):
        files = categories_map.get(category_name) or []
        files.sort(
            key=lambda file_item: (
                int(file_item.get("accessCount") or 0),
                str(file_item.get("lastOpenedAt") or ""),
                str(file_item.get("modifiedAt") or ""),
            ),
            reverse=True,
        )
        categories.append(
            {
                "category": category_name,
                "files": files,
            }
        )
    return categories


@kb_bp.route("/webhooks/kb", methods=["POST"])
def handle_kb_email():
    """Accept email attachments for Knowledge Base ingestion.

    Expected to be called by the mail provider webhook (similar to /webhooks/mailgun).
    Files will be saved under BACKEND_DATA_DIR/kb/<category>/filename.ext,
    with the prior version rotated to filename.ext.old when a duplicate arrives.
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

        safe_name, path = rotate_stored_file_versions(directory, cleaned)

        try:
            file.save(path)
            initial_tags = _derive_tags(category, original_name, mail_subject)
            base_metadata = {
                "source": "email",
                "category": category,
                "originalName": original_name,
                "subject": mail_subject,
                "tags": initial_tags,
            }
            base_metadata["derived_tags_v1"] = _compute_derived_tags_for_metadata(category, safe_name, base_metadata)
            _kb_write_metadata(
                category,
                safe_name,
                base_metadata,
            )
            upsert_file_metadata(
                storage_path=path,
                original_filename=original_name or safe_name,
                content_type=mimetypes.guess_type(safe_name)[0],
                source_host=(request.host or '').split(':', 1)[0].lower(),
                uploaded_by='email-webhook',
                status='stored',
            )
            print(f"[kb] Saved KB doc: {path} (category={category})")
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
    if request.path == '/kb':
        log_deprecated_route('/kb', '/api/kb')

    # Optional filter: ?q=tag or comma-separated tags
    q = (request.args.get("q") or request.args.get("tag") or "").strip().lower()
    q_tags = [t for t in {p.strip().lower() for p in q.split(",")} if t]
    categories = _list_kb_categories(q_tags=q_tags)
    docs = []
    for category in categories:
        for file_item in (category.get("files") or []):
            if isinstance(file_item, dict):
                docs.append(file_item)
    docs.sort(
        key=lambda item: (
            int(item.get("accessCount") or 0),
            str(item.get("lastOpenedAt") or ""),
            str(item.get("modifiedAt") or ""),
        ),
        reverse=True,
    )
    return jsonify({"most_accessed": docs[:5], "categories": categories})


@kb_bp.route("/api/kb/most-accessed", methods=["GET"])
def list_most_accessed_kb():
    try:
        limit = int(request.args.get("limit") or 30)
    except (TypeError, ValueError):
        limit = 30
    limit = max(1, min(limit, 100))

    categories = _list_kb_categories()
    docs = []
    for category in categories:
        category_name = str(category.get("category") or "").strip()
        for file_item in (category.get("files") or []):
            if not isinstance(file_item, dict):
                continue
            docs.append(
                {
                    "category": category_name,
                    "filename": file_item.get("filename") or "",
                    "originalName": file_item.get("originalName") or "",
                    "url": file_item.get("url") or "",
                    "modifiedAt": file_item.get("modifiedAt"),
                    "mimeType": file_item.get("mimeType") or "",
                    "size": file_item.get("size"),
                    "source": file_item.get("source") or "email",
                    "tags": file_item.get("tags") if isinstance(file_item.get("tags"), list) else [],
                    "analysis": file_item.get("analysis") if isinstance(file_item.get("analysis"), dict) else None,
                    "lastOpenedAt": file_item.get("lastOpenedAt"),
                    "access_count": int(file_item.get("access_count") or file_item.get("accessCount") or 0),
                    "accessCount": int(file_item.get("accessCount") or 0),
                }
            )

    # Primary sort by usage count, then recent open, then recent modification.
    docs.sort(
        key=lambda item: (
            int(item.get("accessCount") or 0),
            str(item.get("lastOpenedAt") or ""),
            str(item.get("modifiedAt") or ""),
        ),
        reverse=True,
    )

    return jsonify({"documents": docs[:limit]})


@kb_bp.post('/api/kb/match')
def match_ticket_against_kb():
    payload = request.get_json(silent=True) or {}
    text = str(payload.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'text is required.'}), 400

    categories = _list_kb_categories()
    kb_documents = []
    for category in categories:
        category_name = str(category.get('category') or '').strip()
        for file_item in (category.get('files') or []):
            if not isinstance(file_item, dict):
                continue
            kb_documents.append(
                {
                    'document_id': file_item.get('url') or file_item.get('filename') or '',
                    'category': category_name,
                    'filename': file_item.get('filename') or '',
                    'url': file_item.get('url') or '',
                    'tags': file_item.get('tags') if isinstance(file_item.get('tags'), list) else [],
                    'derived_tags': file_item.get('derived_tags') if isinstance(file_item.get('derived_tags'), dict) else {},
                }
            )

    enable_weighted_matching = bool(current_app.config.get('ENABLE_WEIGHTED_MATCHING', False))
    matches = match_ticket_to_kb(
        ticket_text=text,
        kb_documents=kb_documents,
        enable_weighted_matching=enable_weighted_matching,
    )
    return jsonify(
        {
            'matches': matches,
            'weighted_matching_enabled': enable_weighted_matching,
        }
    )


@kb_bp.route("/kb/<path:category>/<path:filename>", methods=["GET"])
@kb_bp.route("/api/kb/<path:category>/<path:filename>", methods=["GET"])  # alias
def get_kb_file(category, filename):
    if request.path.startswith('/kb/'):
        log_deprecated_route('/kb/<path:category>/<path:filename>', '/api/kb/<path:category>/<path:filename>')

    # Serve with an inline disposition to favor in-browser viewing/printing where supported
    directory = _kb_category_dir(category)
    path = os.path.join(directory, filename)
    if not os.path.isfile(path):
        return jsonify({'error': 'KB document not found.'}), 404

    _touch_kb_access(category, filename)
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
    failure_reason = ''
    try:
        ai_result = analyze_document(text, filename)
    except Exception as error:
        failure_reason = str(error)
        LOGGER.warning('AI analysis failed for KB %s/%s: %s', category, filename, error)

    tags = []
    ai_summary = ''
    structured = {}
    if ai_result:
        ai_summary = str(ai_result.get('summary') or '').strip()
        tags = ai_result.get('tags') if isinstance(ai_result.get('tags'), list) else []
        structured = _build_structured_payload(ai_result, text, failure_reason)
    else:
        structured = _build_structured_payload(ai_result, text, failure_reason)

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
        try:
            meta_tags = json.loads(existing.tags or "[]") if existing.tags else []
        except json.JSONDecodeError:
            meta_tags = []
        _kb_write_analysis_metadata(
            category,
            filename,
            {
                "status": "success" if ai_result else "analysis_unavailable",
                "analyzedAt": existing.updated_at.isoformat() if existing.updated_at else datetime.now(timezone.utc).isoformat(),
                "documentId": existing.id,
                "analyzer": "document_ai",
                "analysisMode": "document_processing",
                "promptSource": "backend/app/services/document_ai.py:PROMPT_TEMPLATE",
                "summary": existing.ai_summary or "",
                "tags": meta_tags if isinstance(meta_tags, list) else [],
            },
        )
        # Mirror documents.py serialization
        try:
            structured_doc = json.loads(existing.ai_structured or '{}') if existing.ai_structured else {}
        except json.JSONDecodeError:
            structured_doc = {}
        try:
            tag_list = json.loads(existing.tags or '[]') if existing.tags else []
        except json.JSONDecodeError:
            tag_list = []
        metadata = _kb_read_metadata(category, filename)
        derived_tags = metadata.get("derived_tags_v1")
        if not isinstance(derived_tags, dict):
            derived_tags = _compute_derived_tags_for_metadata(
                category,
                filename,
                {
                    **metadata,
                    "tags": tag_list if isinstance(tag_list, list) else [],
                },
            )

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
            'derived_tags': derived_tags,
            'created_at': existing.created_at.isoformat() if existing.created_at else None,
            'updated_at': existing.updated_at.isoformat() if existing.updated_at else None,
        })
    finally:
        session.close()
