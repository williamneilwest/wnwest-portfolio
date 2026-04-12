import io
import json
import logging
import mimetypes
from pathlib import Path

try:
    import pytesseract
except ImportError:  # pragma: no cover
    pytesseract = None

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None


LOGGER = logging.getLogger(__name__)
MIN_TEXT_LENGTH_FOR_PDF = 500


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


try:
    from pdf2image import convert_from_path
except ImportError:  # pragma: no cover
    convert_from_path = None

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover
    PdfReader = None


def _ocr_image(image):
    if pytesseract is None or Image is None:
        return ''

    try:
        return (pytesseract.image_to_string(image) or '').strip()
    except Exception:
        return ''


def _parse_pdf(path: Path) -> str:
    text_parts = []

    if PdfReader is not None:
        try:
            reader = PdfReader(str(path))
            for page in reader.pages:
                page_text = page.extract_text() or ''
                if page_text.strip():
                    text_parts.append(page_text.strip())
        except Exception as error:
            LOGGER.warning('PDF text extraction failed for %s: %s', path, error)

    combined = '\n\n'.join(text_parts).strip()
    if len(combined) >= MIN_TEXT_LENGTH_FOR_PDF:
        return combined

    if convert_from_path is None:
        return combined

    try:
        images = convert_from_path(str(path))
    except Exception as error:
        LOGGER.warning('PDF OCR conversion failed for %s: %s', path, error)
        return combined

    ocr_parts = []
    for image in images:
        ocr_text = _ocr_image(image)
        if ocr_text:
            ocr_parts.append(ocr_text)

    fallback = '\n\n'.join(ocr_parts).strip()
    return fallback or combined


def _parse_image(path: Path) -> str:
    if Image is None:
        return ''

    try:
        with Image.open(path) as image:
            return _ocr_image(image)
    except Exception as error:
        LOGGER.warning('Image OCR failed for %s: %s', path, error)
        return ''


def _parse_text_file(path: Path) -> str:
    try:
        return path.read_text(encoding='utf-8', errors='replace').strip()
    except OSError as error:
        LOGGER.warning('Text extraction failed for %s: %s', path, error)
        return ''


def parse_document(file_path):
    path = Path(file_path)
    suffix = path.suffix.lower()
    mime_type, _ = mimetypes.guess_type(path.name)

    if suffix == '.pdf' or mime_type == 'application/pdf':
        text = _parse_pdf(path)
    elif (mime_type or '').startswith('image/') or suffix in {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff'}:
        text = _parse_image(path)
    elif suffix in {'.csv', '.txt', '.log', '.md'} or (mime_type or '').startswith('text/'):
        text = _parse_text_file(path)
    else:
        text = _parse_text_file(path)

    return {
        'text': text or '',
    }


def run_document_processing_task(app, file_path):
    with app.app_context():
        try:
            from ..models.reference import AIDocument, SessionLocal, init_db
            from .document_ai import analyze_document

            init_db()
            extracted = parse_document(file_path)
            text = str((extracted or {}).get('text') or '')
            filename = Path(file_path).name
            mime_type, _ = mimetypes.guess_type(filename)

            ai_result = None
            failure_reason = ''
            try:
                ai_result = analyze_document(text, filename)
            except Exception as error:
                failure_reason = str(error)
                LOGGER.warning('Background AI analysis failed for %s: %s', file_path, error)

            tags = ai_result.get('tags') if isinstance(ai_result, dict) and isinstance(ai_result.get('tags'), list) else []
            summary = str(ai_result.get('summary') or '').strip() if isinstance(ai_result, dict) else ''
            structured = _build_structured_payload(ai_result, text, failure_reason)

            session = SessionLocal()
            try:
                existing = session.query(AIDocument).filter(AIDocument.original_path == str(file_path)).one_or_none()
                if existing is None:
                    existing = AIDocument(
                        filename=filename,
                        original_path=str(file_path),
                    )
                    session.add(existing)

                existing.filename = filename
                existing.original_path = str(file_path)
                existing.file_type = mime_type or Path(filename).suffix.lower().lstrip('.')
                existing.source = 'kb'
                existing.parsed_text = text
                existing.ai_summary = summary
                existing.ai_structured = json.dumps(structured, ensure_ascii=False)
                existing.tags = json.dumps(sorted({str(tag or '').strip().lower() for tag in tags if str(tag or '').strip()}), ensure_ascii=False)
                session.commit()
            finally:
                session.close()
        except Exception as error:
            LOGGER.exception('Background document processing failed for %s: %s', file_path, error)
