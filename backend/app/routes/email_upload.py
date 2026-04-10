import os
from datetime import datetime

from flask import Blueprint, jsonify, request, send_from_directory

email_upload_bp = Blueprint("email_upload", __name__)

UPLOAD_DIR = "/app/data/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@email_upload_bp.route("/webhooks/mailgun", methods=["POST"])
def handle_incoming_email():
    files = request.files
    saved_files = []

    for key in files:
        file = files[key]

        if not file.filename.lower().endswith(".csv"):
            continue

        timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        safe_name = f"{timestamp}_{os.path.basename(file.filename)}"
        path = os.path.join(UPLOAD_DIR, safe_name)

        file.save(path)

        saved_files.append({
            "filename": safe_name,
            "path": path
        })

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
