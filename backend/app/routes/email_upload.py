import base64
import json
import mimetypes
import os
import re
from datetime import datetime, timezone
import logging

from flask import Blueprint, jsonify, request, send_from_directory, has_request_context
from werkzeug.utils import secure_filename

from ..services.tag_derivation import derive_tags
from ..services.file_registry import upsert_file_metadata, move_file_metadata, delete_file_metadata
from ..services.document_ai import analyze_and_store_document
from ..services.document_parser import parse_document
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
AGENT_INGESTION_EXTENSIONS = {
    '.txt', '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.csv', '.md', '.log'
}


def _uploads_dir():
    return get_uploads_dir()


def _request_host():
    if not has_request_context():
        return ''
    return (request.host or '').split(':', 1)[0].lower()


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

        if not normalized and local_part in {'upload', 'uploads'} and domain.startswith('mail.'):
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


def _compute_kb_derived_tags_from_metadata(category: str, filename: str, metadata: dict) -> dict:
    tags = metadata.get('tags') if isinstance(metadata.get('tags'), list) else []
    return derive_tags(
        existing_tags=[str(tag or '').strip().lower() for tag in tags if str(tag or '').strip()],
        document_fields={
            'category': category,
            'filename': filename,
            'original_name': metadata.get('originalName') or filename,
            'subject': metadata.get('subject') or '',
            'summary': (metadata.get('analysis') or {}).get('summary') if isinstance(metadata.get('analysis'), dict) else '',
        },
    )


def _resolve_file_id(file_id: str):
    raw = str(file_id or '').strip().lstrip('/')
    if not raw:
        return None

    if raw.startswith('api/'):
        raw = raw[len('api/'):]

    if raw.startswith('uploads/'):
        filename = clean_filename(raw[len('uploads/'):])
        if not filename:
            return None
        directory = _uploads_dir()
        return {
            'route': 'uploads',
            'directory': directory,
            'filename': filename,
            'category': '',
            'path': os.path.join(directory, filename),
        }

    if raw.startswith('kb/'):
        kb_parts = raw.split('/', 2)
        if len(kb_parts) != 3:
            return None
        category = clean_filename(kb_parts[1])
        filename = clean_filename(kb_parts[2])
        if not category or not filename:
            return None
        directory = get_kb_category_dir(category)
        return {
            'route': 'kb',
            'directory': directory,
            'filename': filename,
            'category': category,
            'path': os.path.join(directory, filename),
        }

    return None


def _serialize_file_record(route, directory, filename, category=''):
    path = os.path.join(directory, filename)
    metadata = _read_directory_metadata(directory, filename)
    source = str(metadata.get('source') or ('email' if route == 'kb' else 'manual')).strip() or 'manual'
    mime_type, _ = mimetypes.guess_type(filename)
    try:
        modified_ts = os.path.getmtime(path)
    except OSError:
        modified_ts = 0

    if route == 'kb':
        url = _build_kb_file_url(filename, category=category or metadata.get('category') or 'uncategorized')
    else:
        url = _build_file_url(filename)

    tags = metadata.get('tags')
    if not isinstance(tags, list):
        tags = []
    derived_tags = metadata.get('derived_tags_v1') if isinstance(metadata.get('derived_tags_v1'), dict) else {}
    if route == 'kb' and not derived_tags:
        derived_tags = _compute_kb_derived_tags_from_metadata(category or metadata.get('category') or '', filename, metadata)

    return {
        'id': url.lstrip('/'),
        'filename': filename,
        'originalName': metadata.get('originalName') or extract_original_name(filename),
        'url': url,
        'modifiedAt': datetime.fromtimestamp(modified_ts, tz=timezone.utc).isoformat() if modified_ts else None,
        'source': source,
        'mimeType': mime_type or 'application/octet-stream',
        'category': category or metadata.get('category') or '',
        'tags': tags,
        'derived_tags': derived_tags if route == 'kb' else {},
    }


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
    try:
        upsert_file_metadata(
            storage_path=path,
            original_filename=original_name or safe_name,
            content_type=mimetypes.guess_type(safe_name)[0],
            source_host=_request_host(),
            uploaded_by='email-webhook' if source == 'email' else source,
            status='stored',
        )
    except Exception:
        LOGGER.warning('Failed to sync file metadata for %s', path)

    if route in {'kb', 'uploads'}:
        try:
            extension = os.path.splitext(safe_name)[1].lower()
            if extension in AGENT_INGESTION_EXTENSIONS:
                extracted = parse_document(path) or {}
                text = str((extracted or {}).get('text') or '')
                if text.strip():
                    analyze_and_store_document(text, safe_name)
        except Exception as error:
            LOGGER.warning('KB ingestion analysis failed for %s: %s', path, error)

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
    full_path = os.path.join(_uploads_dir(), filename)
    if not os.path.isfile(full_path):
        if request.path.startswith('/api/'):
            return jsonify({'error': 'Upload not found.'}), 404
        return ('Not Found', 404)

    return send_from_directory(_uploads_dir(), filename)


@email_upload_bp.route('/api/files/<path:file_id>', methods=['PATCH'])
def update_file_metadata(file_id):
    target = _resolve_file_id(file_id)
    if not target:
        return jsonify({'error': 'Invalid file id.'}), 400

    if not os.path.isfile(target['path']):
        return jsonify({'error': 'File not found.'}), 404

    payload = request.get_json(silent=True) or {}
    new_name = str(payload.get('name') or '').strip()
    new_category = str(payload.get('category') or '').strip()
    raw_tags = payload.get('tags')

    directory = target['directory']
    filename = target['filename']
    category = target['category']
    path = target['path']
    metadata = _read_directory_metadata(directory, filename)

    if isinstance(raw_tags, list):
        metadata['tags'] = sorted({str(tag or '').strip().lower() for tag in raw_tags if str(tag or '').strip()})

    if new_name:
        clean_new_name = clean_filename(new_name)
        if not clean_new_name:
            return jsonify({'error': 'Invalid file name.'}), 400
        old_ext = os.path.splitext(filename)[1].lower()
        next_ext = os.path.splitext(clean_new_name)[1].lower()
        if old_ext and not next_ext:
            clean_new_name = f'{clean_new_name}{old_ext}'
        if clean_new_name != filename:
            next_path = os.path.join(directory, clean_new_name)
            if os.path.exists(next_path):
                return jsonify({'error': 'A file with this name already exists.'}), 409
            os.replace(path, next_path)
            move_file_metadata(path, next_path, original_filename=new_name)
            old_meta_path = _metadata_path_for_directory(directory, filename)
            next_meta_path = _metadata_path_for_directory(directory, clean_new_name)
            if os.path.exists(old_meta_path):
                os.replace(old_meta_path, next_meta_path)
            filename = clean_new_name
            path = next_path
            metadata['originalName'] = new_name

    if target['route'] == 'kb' and new_category:
        clean_category = clean_filename(new_category).lower()
        if not clean_category:
            return jsonify({'error': 'Invalid category.'}), 400
        if clean_category != category:
            next_directory = get_kb_category_dir(clean_category)
            os.makedirs(next_directory, exist_ok=True)
            next_path = os.path.join(next_directory, filename)
            if os.path.exists(next_path):
                return jsonify({'error': 'A file with this name already exists in the target category.'}), 409
            os.replace(path, next_path)
            move_file_metadata(path, next_path, original_filename=metadata.get('originalName') or filename)
            old_meta_path = _metadata_path_for_directory(directory, filename)
            next_meta_path = _metadata_path_for_directory(next_directory, filename)
            if os.path.exists(old_meta_path):
                os.replace(old_meta_path, next_meta_path)
            directory = next_directory
            category = clean_category
            path = next_path
        metadata['category'] = clean_category
    elif target['route'] == 'uploads' and new_category:
        metadata['category'] = new_category

    _write_upload_metadata_for_directory(
        directory,
        filename,
        metadata.get('source') or ('email' if target['route'] == 'kb' else 'manual'),
        recipient=metadata.get('recipient'),
        route=target['route'],
        original_name=metadata.get('originalName') or filename,
    )
    current_meta = _read_directory_metadata(directory, filename)
    if isinstance(metadata.get('tags'), list):
        current_meta['tags'] = metadata['tags']
    if metadata.get('category'):
        current_meta['category'] = metadata['category']
    if target['route'] == 'kb':
        current_meta['derived_tags_v1'] = _compute_kb_derived_tags_from_metadata(
            category or current_meta.get('category') or '',
            filename,
            current_meta,
        )
    with open(_metadata_path_for_directory(directory, filename), 'w', encoding='utf-8') as handle:
        json.dump(current_meta, handle)
    try:
        upsert_file_metadata(
            storage_path=path,
            original_filename=current_meta.get('originalName') or filename,
            content_type=mimetypes.guess_type(filename)[0],
            source_host=_request_host(),
            uploaded_by='user',
            status='stored',
        )
    except Exception:
        LOGGER.warning('Failed to sync updated file metadata for %s', path)

    return jsonify(
        {
            'success': True,
            'data': _serialize_file_record(target['route'], directory, filename, category=category),
        }
    )


@email_upload_bp.route('/api/files/<path:file_id>', methods=['DELETE'])
def delete_file(file_id):
    target = _resolve_file_id(file_id)
    if not target:
        return jsonify({'error': 'Invalid file id.'}), 400

    if not os.path.isfile(target['path']):
        return jsonify({'error': 'File not found.'}), 404

    os.remove(target['path'])
    delete_file_metadata(target['path'])
    meta_path = _metadata_path_for_directory(target['directory'], target['filename'])
    if os.path.exists(meta_path):
        os.remove(meta_path)

    return jsonify({'success': True})
