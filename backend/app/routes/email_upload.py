import base64
import json
import os
from datetime import datetime

from flask import Blueprint, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

email_upload_bp = Blueprint("email_upload", __name__)

UPLOAD_DIR = "/app/data/uploads"
MAX_ATTACHMENT_BYTES = int(os.getenv('MAX_EMAIL_ATTACHMENT_BYTES', str(10 * 1024 * 1024)))
ALLOWED_ATTACHMENT_EXTENSIONS = {
    extension.strip().lower()
    for extension in os.getenv(
        'ALLOWED_EMAIL_ATTACHMENT_EXTENSIONS',
        '.csv,.txt,.pdf,.png,.jpg,.jpeg,.gif,.webp,.xlsx,.xls,.doc,.docx',
    ).split(',')
    if extension.strip()
}
os.makedirs(UPLOAD_DIR, exist_ok=True)


def is_allowed_attachment(filename):
    if not filename:
        return False

    return os.path.splitext(filename)[1].lower() in ALLOWED_ATTACHMENT_EXTENSIONS


def is_csv_attachment(filename):
    return os.path.splitext(filename or '')[1].lower() == '.csv'


def save_uploaded_attachment(file):
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    safe_name = f"{timestamp}_{secure_filename(file.filename)}"
    path = os.path.join(UPLOAD_DIR, safe_name)

    file.save(path)

    return {
        "filename": safe_name,
        "path": path,
        "url": f"/uploads/{safe_name}",
    }


def save_uploaded_attachment_bytes(filename, content):
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    safe_name = f"{timestamp}_{secure_filename(filename)}"
    path = os.path.join(UPLOAD_DIR, safe_name)

    with open(path, 'wb') as handle:
        handle.write(content)

    return {
        "filename": safe_name,
        "path": path,
        "url": f"/uploads/{safe_name}",
    }


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


@email_upload_bp.route("/webhooks/mailgun", methods=["POST"])
def handle_incoming_email():
    saved_files = []

    for file in request.files.values():
        filename = (file.filename or '').strip()
        if not is_allowed_attachment(filename):
            continue

        file.stream.seek(0, os.SEEK_END)
        size = file.stream.tell()
        file.stream.seek(0)
        if size > MAX_ATTACHMENT_BYTES:
            continue

        saved_record = save_uploaded_attachment(file)
        saved_files.append({
            "filename": saved_record["filename"],
            "url": saved_record["url"]
        })

    if not saved_files:
        return jsonify({
            "success": False,
            "message": "No valid attachments were found"
        }), 400

    return jsonify({
        "success": True,
        "saved": saved_files
    })


@email_upload_bp.route("/uploads", methods=["GET"])
def list_uploads():
    files = []

    for name in sorted(os.listdir(UPLOAD_DIR), reverse=True):
        files.append({
            "filename": name,
            "url": f"/uploads/{name}"
        })

    return jsonify(files)


@email_upload_bp.route("/uploads/<path:filename>", methods=["GET"])
def get_upload(filename):
    return send_from_directory(UPLOAD_DIR, filename)
