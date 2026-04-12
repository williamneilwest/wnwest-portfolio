import json
import logging
import os
import re
from pathlib import Path

from flask import current_app

from .ai_client import build_compat_chat_response, call_gateway_chat
from .settings_store import get_ai_model


LOGGER = logging.getLogger(__name__)
PROMPT_TEMPLATE = """You are a high-precision document analysis engine.

Your job is to deeply analyze a knowledge base document and return BOTH:

1. rich, human-quality analysis
2. structured, machine-usable JSON

You MUST preserve important details and NEVER over-summarize critical information.

---

## TOKEN / COMPLEXITY MODE

* Use a HIGH DETAIL level
* Do NOT compress important details
* Prefer completeness over brevity
* Assume output can be up to 4000+ tokens if needed

---

## OUTPUT FORMAT (STRICT)

Return ONLY valid JSON (no markdown, no commentary).

{{
"title": string,
"category": string,

"summary": string[],
"purpose": string,

"systems": string[],
"users": string[],

"access": {{
"ad_group": string | null,
"approval_required": boolean,
"approval_type": string | null,
"estimated_time": string | null
}},

"steps": string[],

"detailed_analysis": {{
"critical_details": string[],
"dependencies": string[],
"constraints": string[],
"environments": string[]
}},

"risks": [
{{
"issue": string,
"severity": "low" | "medium" | "high",
"mitigation": string
}}
],

"validation": string[],

"missing_info": string[],

"tags": string[],

"search_keywords": string[],

"automation": {{
"can_auto_request": boolean,
"can_track_ticket": boolean,
"requires_human_approval": boolean
}}
}}

---

## CRITICAL EXTRACTION RULES (NON-NEGOTIABLE)

1. Active Directory Groups:

   * If ANY AD group is mentioned, extract it EXACTLY
   * NEVER return null if present
   * Example: "AIT-APP-ZIA-ChatGPT"

2. Systems:

   * Include ALL named systems
   * Examples: ServiceNow, Active Directory, ChatGPT Enterprise

3. Steps:

   * MUST include exact values and selections
   * DO NOT generalize
   * Preserve:

     * form types ("New/Modify Access")
     * group names
     * login URLs
     * authentication steps

4. Summary:

   * Must include:

     * approval requirement
     * key system(s)
     * AD group (if present)
     * major constraint (e.g., no PHI/PII)

5. Risks:

   * PRIORITIZE real risks from document
   * If PHI/PII is mentioned → MUST include as HIGH severity
   * Avoid generic filler risks

6. Missing Info:

   * MUST include any unclear or missing instructions
   * Do NOT leave empty if gaps exist

7. Validation:

   * Must reflect real verification steps from document
   * Not generic guesses

---

## QUALITY RULES

* Do NOT reduce content to vague summaries
* Do NOT invent missing values
* Use null if truly absent
* Keep strings concise but specific
* Prefer arrays over paragraphs
* Minimum:

  * summary: 4–8 items
  * steps: 6–12 items (if applicable)
  * risks: at least 2 if present

---

## TAGGING RULES

* tags:

  * lowercase
  * 1–2 words each
  * derived from systems, actions, and concepts

* search_keywords:

  * 3–6 natural phrases
  * what a user would type in search

---

## AUTOMATION LOGIC

* can_auto_request = true if request process exists
* can_track_ticket = true if ticketing system exists
* requires_human_approval = true if approval mentioned

---

## GOAL

Transform the document into a structured, high-fidelity, automation-ready knowledge object WITHOUT losing critical details.

---

## INPUT DOCUMENT

Filename: {filename}

{{document_text}}
"""


def _normalize_string_list(value, lowercase=False):
    if not isinstance(value, list):
        return []

    items = []
    seen = set()
    for item in value:
        normalized = str(item or '').strip()
        if lowercase:
            normalized = normalized.lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        items.append(normalized)
    return items


def _normalize_payload(parsed):
    if not isinstance(parsed, dict):
        return {}

    entities = parsed.get('entities')
    if not isinstance(entities, dict):
        entities = {}

    return {
        'summary': str(parsed.get('summary') or '').strip(),
        'type': str(parsed.get('type') or 'unknown').strip().lower() or 'unknown',
        'tags': _normalize_string_list(parsed.get('tags'), lowercase=True),
        'entities': {
            'systems': _normalize_string_list(entities.get('systems')),
            'users': _normalize_string_list(entities.get('users')),
            'groups': _normalize_string_list(entities.get('groups')),
            'keywords': _normalize_string_list(entities.get('keywords'), lowercase=True),
        },
        'actionable_insights': _normalize_string_list(parsed.get('actionable_insights')),
    }


def _strip_trailing_commas(text):
    return re.sub(r',\s*([}\]])', r'\1', text)


def extract_json(text):
    candidate = str(text or '').strip()
    if not candidate:
        return None

    try:
        return json.loads(candidate)
    except Exception:
        pass

    cleaned = re.sub(r'```json|```', '', candidate, flags=re.IGNORECASE).strip()
    cleaned = _strip_trailing_commas(cleaned)
    try:
        return json.loads(cleaned)
    except Exception:
        pass

    match = re.search(r'\{.*\}', cleaned, re.DOTALL)
    if match:
        snippet = _strip_trailing_commas(match.group(0).strip())
        try:
            return json.loads(snippet)
        except Exception:
            pass

    return None


def _calculate_max_tokens(document_text):
    base = 2500
    per_char = int(len(document_text) / 3)
    calculated = base + per_char
    hard_cap = int(os.getenv('OPENAI_HARD_TOKEN_CAP', '20000'))
    soft_cap = int(os.getenv('OPENAI_MAX_OUTPUT_TOKENS', '16000'))
    return max(2000, min(calculated, soft_cap, hard_cap))


def analyze_document(text, filename):
    text = str(text or '').strip()
    input_char_limit = int(os.getenv('DOCUMENT_AI_INPUT_CHAR_LIMIT', '60000'))
    truncated_text = text[:input_char_limit]

    prompt = PROMPT_TEMPLATE.format(
        filename=Path(filename or '').name,
        document_text=truncated_text,
    )

    document_model = get_ai_model(mode='document_processing')
    max_tokens = _calculate_max_tokens(truncated_text)

    request_payload = {
        'message': prompt,
        'analysis_mode': 'document_processing',
        'model': document_model,
        'max_tokens': max_tokens,
        'preserve_prompt': True,
    }
    gateway_result = call_gateway_chat(
        request_payload,
        current_app.config['AI_GATEWAY_BASE_URL'],
        timeout_seconds=60,
    )
    payload = build_compat_chat_response(request_payload, gateway_result)
    raw_message = str(payload.get('message') or '').strip()
    if not raw_message:
        raise ValueError('AI analysis returned an empty response.')
    usage = gateway_result.get('usage', {}) if isinstance(gateway_result, dict) else {}
    usage = usage if isinstance(usage, dict) else {}
    input_tokens = int(usage.get('prompt_tokens') or usage.get('input_tokens') or 0)
    output_tokens = int(usage.get('completion_tokens') or usage.get('output_tokens') or 0)

    preview = re.sub(r'\s+', ' ', raw_message)[:500]
    LOGGER.info('AI raw response preview for %s: %s', filename, preview)
    first_non_empty_line = next((line.strip() for line in raw_message.splitlines() if line.strip()), '')
    summary = first_non_empty_line[:240] if first_non_empty_line else 'AI analysis completed.'

    return {
        'summary': summary,
        'type': 'raw',
        'tags': [],
        'entities': {
            'systems': [],
            'users': [],
            'groups': [],
            'keywords': [],
        },
        'actionable_insights': [],
        'raw_response': raw_message,
        'input_tokens': input_tokens,
        'output_tokens': output_tokens,
    }
