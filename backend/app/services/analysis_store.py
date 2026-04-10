import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

MAX_RECENT_ANALYSES = 10


def _storage_root():
    return Path(os.getenv('BACKEND_DATA_DIR', '/app/data'))


def _analysis_root():
    return _storage_root() / 'csv_analyses'


def _index_path():
    return _analysis_root() / 'index.json'


def ensure_storage():
    _analysis_root().mkdir(parents=True, exist_ok=True)


def _safe_name(filename):
    cleaned = re.sub(r'[^a-zA-Z0-9._-]+', '-', filename).strip('-')
    return cleaned or 'upload.csv'


def _read_index():
    ensure_storage()
    path = _index_path()

    if not path.exists():
        return []

    with path.open('r', encoding='utf-8') as handle:
        try:
            payload = json.load(handle)
        except json.JSONDecodeError:
            return []

    return payload if isinstance(payload, list) else []


def _write_index(entries):
    ensure_storage()
    with _index_path().open('w', encoding='utf-8') as handle:
        json.dump(entries, handle, indent=2)


def save_analysis(filename, content, analysis):
    ensure_storage()

    analysis_id = uuid.uuid4().hex
    timestamp = datetime.now(timezone.utc).isoformat()
    safe_name = _safe_name(filename)
    stored_name = f'{timestamp[:19].replace(":", "-")}-{analysis_id}-{safe_name}'
    file_path = _analysis_root() / stored_name
    file_path.write_bytes(content)

    record = {
        'id': analysis_id,
        'fileName': filename,
        'savedAt': timestamp,
        'storedFile': stored_name,
        'analysis': analysis,
    }

    entries = _read_index()
    entries.insert(0, record)

    for entry in entries[MAX_RECENT_ANALYSES:]:
        stored_file = entry.get('storedFile')
        if stored_file:
            old_path = _analysis_root() / stored_file
            if old_path.exists():
                old_path.unlink()

    entries = entries[:MAX_RECENT_ANALYSES]
    _write_index(entries)
    return record


def list_recent_analyses():
    entries = _read_index()
    return [
        {
            'id': entry.get('id'),
            'fileName': entry.get('fileName'),
            'savedAt': entry.get('savedAt'),
            'analysis': entry.get('analysis'),
        }
        for entry in entries[:MAX_RECENT_ANALYSES]
    ]


def get_analysis_file(analysis_id):
    entries = _read_index()

    for entry in entries:
        if entry.get('id') != analysis_id:
            continue

        stored_file = entry.get('storedFile')
        if not stored_file:
            return None

        file_path = _analysis_root() / stored_file
        if not file_path.exists():
            return None

        return {
            'fileName': entry.get('fileName') or stored_file,
            'content': file_path.read_bytes(),
        }

    return None
