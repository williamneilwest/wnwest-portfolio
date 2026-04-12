import base64
import json
import mimetypes
import os
import re
from datetime import datetime, timezone
import logging

from flask import Blueprint, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

from ..utils.storage import get_kb_category_dir, get_uploads_dir

email_upload_bp = Blueprint("email_upload", __name__)

LOGGER = logging.getLogger(__name__)
MAX_ATTACHMENT_BYTES = int(os.getenv('MAX_EMAIL_ATTACHMENT_BYTES', str(10 * 1024 * 1024)))
ALLOWED_ATTACHMENT_EXTENSIONS = {
    extension.strip().lower()
    for extension in os.getenv(
        'ALLOWED_EMAIL_ATTACHMENT_EXTENSIONS',
        '.csv,.txt,.pdf,.png,.jpg,.jpeg,.gif,.webp,.xlsx,.xls,.doc,.docx',
    ).split(',')
    if extension.strip()
}


def _uploads_dir():
    return get_uploads_dir()


def _kb_uncategorized_dir():
    return get_kb_category_dir('uncategorized')


def _metadata_path(filename):
    return os.path.join(_uploads_dir(), f'{filename}.meta.json')


def _metadata_path_for_directory(directory, filename):
    return os.path.join(directory, f'{filename}.meta.json')


def _write_upload_metadata(filename, source):
    payload = {
        'source': source or 'manual',
    }

    with open(_metadata_path(filename), 'w', encoding='utf-8') as handle:
        json.dump(payload, handle)


def _write_upload_metadata_for_directory(directory, filename, source, recipient=None, route='uploads', original_name=None):
    payload = {
        'source': source or 'manual',
        'route': route or 'uploads',
    }

    if recipient:
        payload['recipient'] = recipient
    if original_name:
        payload['originalName'] = original_name

    with open(_metadata_path_for_directory(directory, filename), 'w', encoding='utf-8') as handle:
        json.dump(payload, handle)


def _read_upload_metadata(filename):
    path = _metadata_path(filename)
    if not os.path.exists(path):
        return {}

    try:
        with open(path, 'r', encoding='utf-8') as handle:
            parsed = json.load(handle)
            return parsed if isinstance(parsed, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _read_directory_metadata(directory, filename):
    path = _metadata_path_for_directory(directory, filename)
    if not os.path.exists(path):
        return {}

    try:
        with open(path, 'r', encoding='utf-8') as handle:
            parsed = json.load(handle)
            return parsed if isinstance(parsed, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def is_allowed_attachment(filename):
    if not filename:
        return False

    return os.path.splitext(filename)[1].lower() in ALLOWED_ATTACHMENT_EXTENSIONS


def is_csv_attachment(filename):
    return os.path.splitext(filename or '')[1].lower() == '.csv'


# -----------------------------
# Central helpers (public)
# -----------------------------
def clean_filename(name: str) -> str:
    """Return a cleaned, safe filename component.

    - Strips whitespace
    - Uses werkzeug.secure_filename to normalize
    - Returns empty string on malformed input
    """
    try:
        return secure_filename((name or '').strip())
    except Exception:
        return ''


def build_storage_filename(name: str) -> str:
    cleaned = clean_filename(name)
    if not cleaned:
        return ''

    return cleaned


def build_old_storage_filename(name: str) -> str:
    cleaned = clean_filename(name)
    if not cleaned:
        return ''

    return f"{cleaned}.old"


def rotate_stored_file_versions(directory: str, filename: str) -> tuple[str, str]:
    current_path = os.path.join(directory, filename)
    old_filename = build_old_storage_filename(filename)
    old_path = os.path.join(directory, old_filename)
    current_meta_path = _metadata_path_for_directory(directory, filename)
    old_meta_path = _metadata_path_for_directory(directory, old_filename)

    if os.path.exists(current_path):
        if os.path.exists(old_path):
            os.remove(old_path)
        if os.path.exists(old_meta_path):
            os.remove(old_meta_path)

        os.replace(current_path, old_path)

        if os.path.exists(current_meta_path):
            os.replace(current_meta_path, old_meta_path)

    return filename, current_path


def normalize_recipient(recipient: str) -> str:
    value = str(recipient or '').strip().lower()
    if not value:
        return ''

    if '<' in value and '>' in value:
        match = re.search(r'<([^>]+)>', value)
        if match:
            value = match.group(1).strip().lower()

    return value.strip(' ,;')


def _extract_recipients(recipient_value: str) -> list[str]:
    raw = str(recipient_value or '').strip()
    if not raw:
        return []

    matches = re.findall(r'[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}', raw, flags=re.IGNORECASE)
    recipients = [normalize_recipient(match) for match in matches if normalize_recipient(match)]
    if recipients:
        return recipients

    normalized = normalize_recipient(raw)
    return [normalized] if normalized else []


def resolve_target_from_recipient(recipient: str):
    target = 'uploads'
    directory = _uploads_dir()
    normalized = ''

    for candidate in _extract_recipients(recipient):
        local_part = ''
        domain = ''

        if '@' in candidate:
            local_part, domain = candidate.split('@', 1)

        if local_part == 'kb' and domain.startswith('mail.'):
            normalized = candidate
            target = 'kb'
            directory = _kb_uncategorized_dir()
            break

        if not normalized and local_part == 'uploads' and domain.startswith('mail.'):
            normalized = candidate
            target = 'uploads'
            directory = _uploads_dir()

    if not normalized:
        extracted = _extract_recipients(recipient)
        normalized = extracted[0] if extracted else ''

    LOGGER.info('Email routing resolved recipient=%r to target=%s', normalized or recipient or '', target)
    return {
        'recipient': normalized,
        'target': target,
        'directory': directory,
    }


def extract_recipient_from_request():
    candidate_map = {
        'form.to': request.form.get('to'),
        'form.To': request.form.get('To'),
        'form.recipient': request.form.get('recipient'),
        'form.envelope': request.form.get('envelope'),
        'form.headers': request.form.get('headers'),
        'header.X-Original-To': request.headers.get('X-Original-To'),
        'header.X-Envelope-To': request.headers.get('X-Envelope-To'),
        'header.To': request.headers.get('To'),
    }
    recipients = []

    for source, candidate in candidate_map.items():
        extracted = _extract_recipients(candidate)
        if extracted:
            LOGGER.info('Email recipient candidates source=%s values=%s', source, extracted)
            recipients.extend(extracted)

    if not recipients:
        LOGGER.info(
            'Email recipient detection found no matches form_keys=%s header_keys=%s',
            sorted(request.form.keys()),
            [key for key in ('To', 'X-Original-To', 'X-Envelope-To') if request.headers.get(key)],
        )
        return ''

    deduped = []
    seen = set()
    for recipient in recipients:
        if recipient in seen:
            continue
        seen.add(recipient)
        deduped.append(recipient)

    return ', '.join(deduped)


def extract_original_name(saved_name: str) -> str:
    """Extract the original filename portion from a stored name.

    Supports legacy timestamped names and the current stable-name storage pattern.
    If no recognizable timestamp prefix exists, returns a cleaned fallback.
    """
    if not saved_name:
        return ''

    try:
        base = os.path.basename(saved_name)
    except Exception:
        base = saved_name

    # Fast path: our standard format "YYYYMMDDHHMMSS_<name>"
    try:
        underscore = base.index('_')
        ts_part = base[:underscore]
        if ts_part.isdigit() and 8 <= len(ts_part) <= 14:
            return base[underscore + 1 :]
    except ValueError:
        pass

    # General pattern: leading timestamp followed by space/underscore/dash
    try:
        import re  # local import to avoid global cost on cold paths

        m = re.match(r"^(\d{8,14})[\s_-]+(.+)$", base)
        if m:
            return m.group(2)
    except Exception:
        pass

    # Fallback: return a cleaned version of the input (safe, stable)
    return clean_filename(base)


def _build_file_url(filename: str) -> str:
    """Generate a consistent URL for a stored file (back-compat path)."""
    return f"/uploads/{filename}"


def _build_kb_file_url(filename: str, category: str = 'uncategorized') -> str:
    safe_category = clean_filename(category) or 'uncategorized'
    return f"/kb/{safe_category}/{filename}"


def save_attachment_bytes_to_directory(filename, content, directory, source='manual', recipient=None, route='uploads'):
    original_name = str(filename or '').strip()
    cleaned = clean_filename(original_name)
    if not cleaned:
        raise ValueError('Attachment filename is missing or invalid.')

    os.makedirs(directory, exist_ok=True)
    safe_name = build_storage_filename(cleaned)
    safe_name, path = rotate_stored_file_versions(directory, safe_name)

    with open(path, 'wb') as handle:
        handle.write(content)

    _write_upload_metadata_for_directory(
        directory,
        safe_name,
        source,
        recipient=recipient,
        route=route,
        original_name=original_name,
    )
    LOGGER.info('Saved file path=%s source=%s route=%s', path, source, route)

    return {
        "filename": safe_name,
        "path": path,
        "url": _build_kb_file_url(safe_name) if route == 'kb' else _build_file_url(safe_name),
    }


def save_uploaded_attachment(file, source='manual'):
    original_name = (file.filename or '').strip()
    content = file.read()
    if hasattr(file, 'stream'):
        try:
            file.stream.seek(0)
        except OSError:
            pass
    return save_attachment_bytes_to_directory(original_name, content, _uploads_dir(), source=source, route='uploads')


def save_uploaded_attachment_bytes(filename, content, source='manual'):
    return save_attachment_bytes_to_directory(filename, content, _uploads_dir(), source=source, route='uploads')


def _get_sendgrid_attachment_names():
    raw = request.form.get('attachment-info', '')
    if not raw:
        return {}

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {}

    if not isinstance(payload, dict):
        return {}

    attachment_names = {}
    for key, value in payload.items():
        if not isinstance(value, dict):
            continue

        filename = value.get('filename')
        if filename:
            attachment_names[key] = filename

    return attachment_names


def iter_sendgrid_attachments():
    attachment_names = _get_sendgrid_attachment_names()

    for key, value in request.form.items():
        if not key.startswith('attachment'):
            continue

        filename = attachment_names.get(key, f'{key}.csv')

        try:
            content = base64.b64decode(value, validate=True)
        except (ValueError, TypeError):
            continue

        if not is_allowed_attachment(filename):
            continue

        if len(content) > MAX_ATTACHMENT_BYTES:
            continue

        yield {
            'field': key,
            'filename': filename,
            'content': content,
        }


def _extract_saved_original_name(saved_filename):
    """Deprecated: use extract_original_name"""
    return extract_original_name(saved_filename)


@email_upload_bp.route("/webhooks/mailgun", methods=["POST"])
def handle_incoming_email():
    saved_files = []
    routing = resolve_target_from_recipient(extract_recipient_from_request())

    for file in request.files.values():
        filename = (file.filename or '').strip()
        if not is_allowed_attachment(filename):
            continue

        file.stream.seek(0, os.SEEK_END)
        size = file.stream.tell()
        file.stream.seek(0)
        if size > MAX_ATTACHMENT_BYTES:
            continue

        saved_record = save_attachment_bytes_to_directory(
            filename,
            file.read(),
            routing['directory'],
            source='email',
            recipient=routing['recipient'],
            route=routing['target'],
        )
        saved_files.append({
            "filename": saved_record["filename"],
            "url": saved_record["url"],
            "route": routing['target'],
        })

    if not saved_files:
        return jsonify({
            "success": False,
            "message": "No valid attachments were found"
        }), 400

    return jsonify({
        "success": True,
        "saved": saved_files,
        "route": routing['target'],
    })


@email_upload_bp.route("/uploads", methods=["GET"])
@email_upload_bp.route("/api/uploads", methods=["GET"])  # parallel API path (back-compat preserved)
def list_uploads():
    files = []
    uploads_dir = _uploads_dir()

    try:
        names = os.listdir(uploads_dir)
    except OSError:
        names = []

    for name in names:
        # Skip metadata sidecar files
        if name.endswith('.meta.json'):
            continue

        full_path = os.path.join(uploads_dir, name)

        # Basic file check
        if not os.path.isfile(full_path):
            continue

        try:
            modified_ts = os.path.getmtime(full_path)
        except OSError:
            modified_ts = 0

        metadata = _read_upload_metadata(name)
        source = str(metadata.get('source') or 'manual').strip() or 'manual'
        original = metadata.get('originalName') or extract_original_name(name)
        mime_type, _ = mimetypes.guess_type(name)
        files.append({
            "filename": name,
            "originalName": original,
            "url": _build_file_url(name),
            "path": full_path,
            "modifiedAt": datetime.fromtimestamp(modified_ts, tz=timezone.utc).isoformat() if modified_ts else None,
            "source": source,
            "mimeType": mime_type or 'application/octet-stream',
        })

    # Newest first
    files.sort(key=lambda x: (x["modifiedAt"] or ""), reverse=True)

    return jsonify(files)


@email_upload_bp.route("/uploads/<path:filename>", methods=["GET"])
@email_upload_bp.route("/api/uploads/<path:filename>", methods=["GET"])  # parallel API path
def get_upload(filename):
    return send_from_directory(_uploads_dir(), filename)
