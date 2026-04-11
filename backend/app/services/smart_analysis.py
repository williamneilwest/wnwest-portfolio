import hashlib
import json
import os
import re
from pathlib import Path

from .ai_client import clean_ticket_text
from .data_processing import normalize_headers


DEFAULT_MAX_INPUT_CHARS = 4000
MAX_TEXT_FIELD_CHARS = 500
DEFAULT_PREVIEW_ROW_LIMIT = 10
DEFAULT_FOCUSED_ROW_LIMIT = 5
FULL_DATASET_CHUNK_SIZE = 10
TICKET_PATTERNS = [r'ticket', r'number', r'incident', r'u_task']
NOTE_PATTERNS = [r'comment', r'work_note', r'note', r'journal']
SIGNATURE_PATTERNS = [
    r'best regards.*',
    r'regards,?.*',
    r'thanks,?.*',
    r'sent from my iphone.*',
]


def max_input_chars():
    configured = os.getenv('MAX_INPUT_CHARS', str(DEFAULT_MAX_INPUT_CHARS)).strip()
    try:
        return max(1000, int(configured))
    except ValueError:
        return DEFAULT_MAX_INPUT_CHARS


def _cache_root():
    return Path(os.getenv('BACKEND_DATA_DIR', '/app/data')) / 'ai_analysis_cache'


def _cache_path(cache_key):
    return _cache_root() / f'{cache_key}.json'


def _normalize_value(value):
    return str(value or '').strip()


def _normalize_header_label(value):
    return _normalize_value(value).replace('_', ' ')


def _clean_text(value, max_chars=MAX_TEXT_FIELD_CHARS):
    text = clean_ticket_text(_normalize_value(value))

    for pattern in SIGNATURE_PATTERNS:
        text = re.sub(pattern, '', text, flags=re.IGNORECASE | re.DOTALL)

    text = re.sub(r'\s+', ' ', text).strip()
    if len(text) > max_chars:
        return f'{text[: max_chars - 3].rstrip()}...'
    return text


def _drop_empty_fields(row):
    return {key: value for key, value in row.items() if _normalize_value(value)}


def _dedupe_rows(rows):
    deduped = []
    seen = set()

    for row in rows:
        marker = json.dumps(row, sort_keys=True, ensure_ascii=True)
        if marker in seen:
            continue
        seen.add(marker)
        deduped.append(row)

    return deduped


def _normalize_rows(columns, rows):
    normalized_columns = normalize_headers(columns)
    output_rows = []

    for row in rows or []:
        normalized_row = {}
        for source_key, normalized_key in zip(columns, normalized_columns):
            value = row.get(source_key, row.get(normalized_key, ''))
            cleaned_value = _clean_text(value)
            if cleaned_value:
                normalized_row[normalized_key] = cleaned_value
        if normalized_row:
            output_rows.append(normalized_row)

    return normalized_columns, _dedupe_rows(output_rows)


def _stringify_rows(rows):
    return json.dumps(rows, ensure_ascii=False, indent=2)


def _ticket_dataset(columns):
    haystack = ' '.join(columns).lower()
    return any(re.search(pattern, haystack, re.IGNORECASE) for pattern in TICKET_PATTERNS)


def _find_column(columns, patterns):
    for column in columns:
        label = column.lower()
        if any(re.search(pattern, label, re.IGNORECASE) for pattern in patterns):
            return column
    return ''


def _ticket_payload(rows, columns):
    ticket_id_column = _find_column(columns, [r'^ticket$', r'number', r'incident', r'u_task'])
    issue_column = _find_column(columns, [r'short_description', r'subject', r'title', r'description'])
    status_column = _find_column(columns, [r'^status$', r'^state$', r'priority'])
    assignee_column = _find_column(columns, [r'assigned_to', r'assignee', r'owner'])
    note_columns = [column for column in columns if any(re.search(pattern, column, re.IGNORECASE) for pattern in NOTE_PATTERNS)]

    transformed = []
    for row in rows:
        note_entries = [_clean_text(row.get(column, ''), max_chars=220) for column in note_columns]
        note_entries = [entry for entry in note_entries if entry]
        latest_update = note_entries[0] if note_entries else ''
        history_summary = ' | '.join(note_entries[:3])
        transformed.append(
            _drop_empty_fields(
                {
                    'ticket_id': row.get(ticket_id_column, ''),
                    'issue': row.get(issue_column, ''),
                    'latest_update': latest_update,
                    'history_summary': history_summary,
                    'status': row.get(status_column, ''),
                    'assigned_to': row.get(assignee_column, ''),
                }
            )
        )

    return transformed


def _pipeline_setting(pipeline, key, fallback):
    try:
        return max(1, int((pipeline or {}).get(key, fallback)))
    except (TypeError, ValueError):
        return fallback


def _select_records(rows, mode, pipeline=None):
    if mode == 'preview':
        return rows[:_pipeline_setting(pipeline, 'preview_max_rows', DEFAULT_PREVIEW_ROW_LIMIT)]
    if mode == 'focused':
        ranked = sorted(rows, key=lambda row: len(row), reverse=True)
        return ranked[:_pipeline_setting(pipeline, 'focused_max_rows', DEFAULT_FOCUSED_ROW_LIMIT)]
    return rows


def _chunk_records(rows, size=FULL_DATASET_CHUNK_SIZE):
    return [rows[index : index + size] for index in range(0, len(rows), size)]


def _payload_hash(payload):
    serialized = json.dumps(payload, sort_keys=True, ensure_ascii=True)
    return hashlib.sha256(serialized.encode('utf-8')).hexdigest()


def get_cached_result(cache_key):
    path = _cache_path(cache_key)
    if not path.exists():
        return None

    try:
        with path.open('r', encoding='utf-8') as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None


def save_cached_result(cache_key, payload):
    cache_root = _cache_root()
    cache_root.mkdir(parents=True, exist_ok=True)
    with _cache_path(cache_key).open('w', encoding='utf-8') as handle:
        json.dump(payload, handle, indent=2)


def smart_analysis_requested(payload):
    return bool(payload.get('analysis_mode') or payload.get('dataset') or payload.get('ticket'))


def resolve_mode(payload):
    mode = _normalize_value(payload.get('analysis_mode')).lower() or 'preview'
    return mode if mode in {'preview', 'focused', 'deep', 'full_dataset'} else 'preview'


def _extract_dataset(payload):
    if payload.get('ticket'):
        ticket = payload['ticket']
        rows = [ticket] if isinstance(ticket, dict) else []
        columns = list(ticket.keys()) if isinstance(ticket, dict) else []
        filename = _normalize_value(payload.get('fileName')) or 'ticket.json'
        return filename, columns, rows

    dataset = payload.get('dataset') or {}
    rows = dataset.get('rows') if isinstance(dataset.get('rows'), list) else []
    columns = dataset.get('columns') if isinstance(dataset.get('columns'), list) else list(rows[0].keys()) if rows else []
    filename = _normalize_value(dataset.get('fileName') or payload.get('fileName')) or 'dataset.json'
    return filename, columns, rows


def prepare_analysis_request(payload, settings=None):
    mode = resolve_mode(payload)
    pipeline = (settings or {}).get('pipeline', {})
    filename, source_columns, source_rows = _extract_dataset(payload)
    columns, rows = _normalize_rows(source_columns, source_rows)
    is_ticket_dataset = _ticket_dataset(columns)
    prepared_rows = _ticket_payload(rows, columns) if is_ticket_dataset else rows
    truncated = False

    if mode == 'deep' and prepared_rows:
        prepared_rows = prepared_rows[:1]

    selected_rows = _select_records(prepared_rows, mode, pipeline=pipeline)
    serialized_rows = _stringify_rows(selected_rows)
    if len(serialized_rows) > max_input_chars() and mode in {'preview', 'focused'}:
        selected_rows = selected_rows[: min(5, len(selected_rows))]
        serialized_rows = _stringify_rows(selected_rows)
        truncated = True

    cache_key = None
    if mode in {'preview', 'full_dataset'}:
        cache_key = _payload_hash({'mode': mode, 'rows': prepared_rows, 'fileName': filename})

    return {
        'mode': mode,
        'fileName': filename,
        'columns': columns,
        'records': prepared_rows,
        'selectedRecords': selected_rows,
        'isTicketDataset': is_ticket_dataset,
        'truncated': truncated,
        'cacheKey': cache_key,
        'recordsUsed': len(selected_rows),
        'recordCount': len(prepared_rows),
        'pipeline': pipeline,
    }


def preferred_model(mode, available_models, settings=None):
    available = [_normalize_value(model) for model in available_models if _normalize_value(model)]
    configured_models = (settings or {}).get('models', {})
    if mode == 'full_dataset':
        candidate = configured_models.get('full_dataset') or configured_models.get('deep')
    else:
        candidate = configured_models.get(mode)
    normalized_candidate = _normalize_value(candidate)

    if normalized_candidate and normalized_candidate in available:
        return normalized_candidate

    return available[0] if available else 'ollama/llama3.2'


def _preview_prompt(prepared):
    return '\n'.join(
        [
            'Summarize high-level trends, common issues, and overall patterns. Do NOT analyze deeply. Limit to 5 bullet points.',
            'Return valid JSON with keys: summary, insights, meta.',
            f'Dataset: {prepared["fileName"]}',
            f'Records included: {prepared["recordsUsed"]} of {prepared["recordCount"]}',
            'Records:',
            _stringify_rows(prepared['selectedRecords']),
        ]
    )


def _focused_prompt(prepared):
    return '\n'.join(
        [
            'Analyze the following subset of records. Identify common root causes, repeated issues, and any anomalies. Keep response concise.',
            'Return valid JSON with keys: summary, insights, meta.',
            f'Dataset: {prepared["fileName"]}',
            f'Records included: {prepared["recordsUsed"]}',
            'Records:',
            _stringify_rows(prepared['selectedRecords']),
        ]
    )


def _deep_prompt(prepared):
    record = prepared['selectedRecords'][0] if prepared['selectedRecords'] else {}
    return '\n'.join(
        [
            'Analyze this IT support ticket.',
            '',
            'You MUST infer details from the provided information. Do NOT say "unknown", "none", or "unspecified" unless absolutely impossible.',
            '',
            'Return ONLY valid JSON (no markdown, no backticks).',
            '',
            'Format:',
            '{',
            '  "root_cause": "...",',
            '  "work_performed": "...",',
            '  "current_status": "...",',
            '  "blocker": "...",',
            '  "next_step": "...",',
            '  "stalled": true/false',
            '}',
            '',
            'Rules:',
            '- Use only technical information',
            '- Infer likely root cause from symptoms if not explicitly stated',
            '- Summarize work performed from notes',
            '- Keep answers concise but meaningful',
            '- Do not include markdown fences or explanatory text',
            '',
            'Ticket:',
            json.dumps(record, ensure_ascii=False, indent=2),
        ]
    )


def _full_dataset_chunk_prompt(chunk, index, total):
    return '\n'.join(
        [
            'Summarize key insights from this subset of data.',
            'Return valid JSON with keys: summary, insights, meta.',
            f'Chunk {index} of {total}',
            'Records:',
            _stringify_rows(chunk),
        ]
    )


def _full_dataset_final_prompt(chunk_summaries, prepared):
    return '\n'.join(
        [
            'Combine these summaries into a single cohesive analysis of trends, issues, and insights.',
            'Return valid JSON with keys: summary, insights, meta.',
            f'Dataset: {prepared["fileName"]}',
            'Chunk summaries:',
            json.dumps(chunk_summaries, ensure_ascii=False, indent=2),
        ]
    )


def build_execution_plan(prepared, model):
    mode = prepared['mode']

    if mode == 'preview':
        return {'mode': mode, 'model': model, 'prompt': _preview_prompt(prepared)}
    if mode == 'focused':
        return {'mode': mode, 'model': model, 'prompt': _focused_prompt(prepared)}
    if mode == 'deep':
        return {'mode': mode, 'model': model, 'prompt': _deep_prompt(prepared)}

    chunks = _chunk_records(prepared['records'])
    return {
        'mode': mode,
        'model': model,
        'chunks': [_full_dataset_chunk_prompt(chunk, index + 1, len(chunks)) for index, chunk in enumerate(chunks)],
        'finalPrompt': _full_dataset_final_prompt,
    }


def parse_llm_json(raw_message):
    if isinstance(raw_message, dict):
        return raw_message

    text = _normalize_value(raw_message)
    if not text:
        return {}

    for candidate in (text, *re.findall(r'\{.*\}', text, flags=re.DOTALL)):
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue

    insights = []
    summary = ''
    for line in text.splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        if cleaned.startswith(('-', '*')):
            insights.append(cleaned.lstrip('-* ').strip())
        elif not summary:
            summary = cleaned
    return {'summary': summary or text, 'insights': insights}


def format_deep_message(parsed):
    summary = _normalize_value(parsed.get('summary') or parsed.get('root_cause'))
    work_performed = parsed.get('work_performed') or parsed.get('workPerformed') or []
    if isinstance(work_performed, str):
        work_performed = [work_performed]
    comments = parsed.get('insights') or []
    if isinstance(comments, str):
        comments = [comments]
    status_lines = [
        parsed.get('current_status') or parsed.get('currentStatus') or '',
        f"Root cause: {parsed.get('root_cause') or parsed.get('rootCause') or 'Unknown'}",
        f"Blocker: {parsed.get('blocker') or 'None'}",
        f"Next step: {parsed.get('next_step') or parsed.get('nextStep') or 'Unspecified'}",
        f"Stalled: {parsed.get('stalled')}",
    ]
    status = '\n'.join([line for line in status_lines if _normalize_value(line)])

    lines = ['Summary:', summary or 'No summary returned.', '', 'Work Notes:']
    lines.extend([f'- {item}' for item in work_performed] or ['- No work notes returned.'])
    lines.extend(['', 'Comments:'])
    lines.extend([f'- {item}' for item in comments] or ['- No comments returned.'])
    lines.extend(['', 'Status:', status or 'No status returned.'])
    return '\n'.join(lines)


def build_output_payload(mode, parsed, meta):
    summary = _normalize_value(parsed.get('summary')) or 'No summary returned.'
    insights = parsed.get('insights') or []
    if isinstance(insights, str):
        insights = [insights]
    insights = [_normalize_value(item) for item in insights if _normalize_value(item)]

    output = {
        'status': 'ok',
        'mode': mode,
        'summary': summary,
        'insights': insights,
        'meta': meta,
    }

    if mode == 'deep':
        output['message'] = format_deep_message(parsed)
    else:
        bullet_lines = '\n'.join([f'- {item}' for item in insights[:5]])
        output['message'] = '\n'.join([summary, bullet_lines]).strip()

    return output


def has_meaningful_ticket_data(prepared):
    if prepared['mode'] != 'deep':
        return True

    record = prepared['selectedRecords'][0] if prepared['selectedRecords'] else {}
    latest_update = _normalize_value(record.get('latest_update'))
    history_summary = _normalize_value(record.get('history_summary'))
    issue = _normalize_value(record.get('issue'))

    return bool(latest_update or history_summary or issue)
