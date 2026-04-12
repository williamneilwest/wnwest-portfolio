import json
import logging
import mimetypes
import os
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from ..models.reference import AIDocument, SessionLocal, init_db
from ..services.document_ai import analyze_document
from ..services.document_parser import parse_document


documents_bp = Blueprint('documents', __name__)
LOGGER = logging.getLogger(__name__)


def _ensure_db():
    try:
        init_db()
    except Exception:
        pass


def _detect_source(file_path: str) -> str:
    normalized = str(file_path or '').lower()
    if '/kb/' in normalized:
        return 'kb'
    if '/uploads/' in normalized:
        return 'uploads'
    return 'manual'


def _serialize_document(record: AIDocument):
    try:
        structured = json.loads(record.ai_structured or '{}') if record.ai_structured else {}
    except json.JSONDecodeError:
        structured = {}

    try:
        tags = json.loads(record.tags or '[]') if record.tags else []
    except json.JSONDecodeError:
        tags = []

    return {
        'id': record.id,
        'filename': record.filename,
        'original_path': record.original_path,
        'file_type': record.file_type or '',
        'source': record.source or '',
        'parsed_text': record.parsed_text or '',
        'ai_summary': record.ai_summary or '',
        'ai_structured': structured if isinstance(structured, dict) else {},
        'tags': tags if isinstance(tags, list) else [],
        'created_at': record.created_at.isoformat() if record.created_at else None,
        'updated_at': record.updated_at.isoformat() if record.updated_at else None,
    }


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


def _analysis_metadata_path(file_path: str) -> str:
    directory = os.path.dirname(file_path or '')
    filename = os.path.basename(file_path or '')
    if not directory or not filename:
        return ''
    return os.path.join(directory, f'{filename}.meta.json')


def _read_analysis_metadata(file_path: str) -> dict:
    meta_path = _analysis_metadata_path(file_path)
    if not meta_path or not os.path.exists(meta_path):
        return {}
    try:
        with open(meta_path, 'r', encoding='utf-8') as handle:
            data = json.load(handle)
            return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write_analysis_metadata(file_path: str, analysis_payload: dict):
    meta_path = _analysis_metadata_path(file_path)
    if not meta_path:
        return
    merged = dict(_read_analysis_metadata(file_path))
    merged['analysis'] = analysis_payload
    try:
        with open(meta_path, 'w', encoding='utf-8') as handle:
            json.dump(merged, handle)
    except OSError:
        LOGGER.warning('Failed to write analysis metadata for %s', file_path)


@documents_bp.post('/api/documents/analyze')
def analyze_uploaded_document():
    _ensure_db()
    payload = request.get_json(silent=True) or {}
    file_path = str(payload.get('filePath') or '').strip()

    if not file_path:
        return jsonify({'error': 'filePath is required.'}), 400

    if not os.path.isfile(file_path):
        return jsonify({'error': 'Document file not found.'}), 404

    filename = os.path.basename(file_path)
    mime_type, _ = mimetypes.guess_type(filename)
    extracted = parse_document(file_path)
    text = str((extracted or {}).get('text') or '')

    ai_result = None
    failure_reason = ''
    try:
        ai_result = analyze_document(text, filename)
    except Exception as error:
        failure_reason = str(error)
        LOGGER.warning('AI analysis failed for %s: %s', file_path, error)

    tags = []
    ai_summary = ''
    structured = {}
    if ai_result:
        ai_summary = str(ai_result.get('summary') or '').strip()
        tags = ai_result.get('tags') if isinstance(ai_result.get('tags'), list) else []
        structured = _build_structured_payload(ai_result, text, failure_reason)
    else:
        structured = _build_structured_payload(ai_result, text, failure_reason)

    session = SessionLocal()
    try:
        existing = session.query(AIDocument).filter(AIDocument.original_path == file_path).one_or_none()
        if existing is None:
            existing = AIDocument(
                filename=filename,
                original_path=file_path,
                file_type=mime_type or os.path.splitext(filename)[1].lower().lstrip('.'),
                source=_detect_source(file_path),
            )
            session.add(existing)

        existing.filename = filename
        existing.file_type = mime_type or os.path.splitext(filename)[1].lower().lstrip('.')
        existing.source = _detect_source(file_path)
        existing.parsed_text = text
        existing.ai_summary = ai_summary
        existing.ai_structured = json.dumps(structured, ensure_ascii=False)
        existing.tags = json.dumps(sorted({str(tag or '').strip().lower() for tag in tags if str(tag or '').strip()}), ensure_ascii=False)
        existing.updated_at = datetime.now(timezone.utc)
        if existing.created_at is None:
            existing.created_at = datetime.now(timezone.utc)

        session.commit()
        session.refresh(existing)
        if ai_result:
            try:
                meta_tags = json.loads(existing.tags or '[]') if existing.tags else []
            except json.JSONDecodeError:
                meta_tags = []
            _write_analysis_metadata(
                file_path,
                {
                    'status': 'success',
                    'analyzedAt': existing.updated_at.isoformat() if existing.updated_at else datetime.now(timezone.utc).isoformat(),
                    'documentId': existing.id,
                    'summary': existing.ai_summary or '',
                    'tags': meta_tags if isinstance(meta_tags, list) else [],
                },
            )
        return jsonify(_serialize_document(existing))
    finally:
        session.close()


@documents_bp.get('/api/documents')
def list_analyzed_documents():
    _ensure_db()
    session = SessionLocal()
    try:
        records = session.query(AIDocument).order_by(AIDocument.created_at.desc()).all()
        return jsonify(
            [
                {
                    'id': record.id,
                    'filename': record.filename,
                    'tags': _serialize_document(record)['tags'],
                    'ai_summary': record.ai_summary or '',
                    'created_at': record.created_at.isoformat() if record.created_at else None,
                }
                for record in records
            ]
        )
    finally:
        session.close()


@documents_bp.get('/api/documents/<int:document_id>')
def get_analyzed_document(document_id):
    _ensure_db()
    session = SessionLocal()
    try:
        record = session.get(AIDocument, document_id)
        if not record:
            return jsonify({'error': 'Document not found.'}), 404
        return jsonify(_serialize_document(record))
    finally:
        session.close()
