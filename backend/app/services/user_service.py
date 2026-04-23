from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from .data_sources.manager import get_source
from .flow_templates import list_flow_templates, run_flow_template
from .group_lookup import get_user_groups_via_flow
from .flow_ingest_service import upsert_users
from ..models.reference import SessionLocal, User
from ..utils.flow_normalizer import normalize_user_profile_response


OPID_PATTERN = re.compile(r'^[a-z0-9]{6}$', re.IGNORECASE)
CONTEXT_CACHE_TTL_SECONDS = 300
_CONTEXT_CACHE: dict[str, dict] = {}


def _now_utc():
    return datetime.now(timezone.utc)


def _clean(value):
    return str(value or '').strip()


def _normalize_user_row(row):
    if not isinstance(row, dict):
        return None

    opid = _clean(
        row.get('opid')
        or row.get('user_user_name')
        or row.get('user_id')
        or row.get('id')
        or row.get('emplid')
    ).lower()
    if not opid:
        return None

    name = _clean(
        row.get('display_name')
        or row.get('name')
        or row.get('full_name')
        or row.get('user_name')
    ) or opid

    return {
        'opid': opid,
        'name': name,
        'email': _clean(row.get('email') or row.get('mail')),
        'department': _clean(row.get('department')),
        'location': _clean(row.get('location')),
        'title': _clean(row.get('job_title') or row.get('title')),
        'source': _clean(row.get('source')) or 'users_source',
    }


def _load_users_rows():
    rows = []
    for source_key in ('users_master', 'users'):
        source_rows = get_source(source_key, normalized=True)
        if isinstance(source_rows, list) and source_rows:
            rows.extend(source_rows)

    if rows:
        return rows

    session = SessionLocal()
    try:
        users = session.query(User).all()
        return [
            {
                'opid': _clean(user.id),
                'display_name': _clean(user.display_name or user.name),
                'name': _clean(user.display_name or user.name),
                'email': _clean(user.email),
                'department': _clean(user.department),
                'location': _clean(user.location),
                'job_title': _clean(user.job_title),
                'source': _clean(user.source) or 'ref_users',
            }
            for user in users
        ]
    finally:
        session.close()


def _find_user_in_sources(identifier):
    query = _clean(identifier).lower()
    if not query:
        return None

    is_opid = bool(OPID_PATTERN.fullmatch(query))
    best = None
    for row in _load_users_rows():
        normalized = _normalize_user_row(row)
        if normalized is None:
            continue

        opid = normalized['opid'].lower()
        name = normalized['name'].lower()
        email = normalized['email'].lower()

        if is_opid and opid == query:
            return normalized

        if query == name or query == email:
            return normalized

        if query in opid or query in name or query in email:
            if best is None:
                best = normalized

    return best


def _find_user_profile_template_id():
    templates = list_flow_templates()
    for template in templates:
        display_name = _clean(template.get('display_name')).lower()
        script_name = _clean(template.get('script_name')).lower()
        if 'get user profile' in display_name or 'get_user_profile' in script_name:
            return int(template.get('id') or 0)
    return 0


def _load_cached_profile(opid):
    session = SessionLocal()
    try:
        user = session.get(User, opid)
        if user is None:
            return {}
        return {
            'opid': _clean(user.id).lower(),
            'display_name': _clean(user.display_name or user.name),
            'name': _clean(user.display_name or user.name),
            'email': _clean(user.email),
            'job_title': _clean(user.job_title),
            'department': _clean(user.department),
            'location': _clean(user.location),
            'account_enabled': user.account_enabled,
            'source': _clean(user.source) or 'ref_users',
        }
    finally:
        session.close()


def _run_profile_flow(opid, *, user_id=None):
    template_id = _find_user_profile_template_id()
    if template_id <= 0:
        return {}

    payload = run_flow_template(
        template_id,
        {
            'query': opid,
            'username': opid,
            'user_opid': opid,
            'userOpid': opid,
            'user_id': opid,
        },
        user_id=user_id,
    )
    normalized = normalize_user_profile_response(payload, opid) or {}
    if normalized:
        upsert_users(
            [
                {
                    'opid': normalized.get('opid') or opid,
                    'display_name': normalized.get('display_name'),
                    'name': normalized.get('display_name'),
                    'email': normalized.get('email'),
                    'job_title': normalized.get('job_title'),
                    'department': normalized.get('department'),
                    'location': normalized.get('location'),
                    'account_enabled': normalized.get('account_enabled'),
                    'source': 'flow',
                    'raw_json': normalized.get('raw') if isinstance(normalized.get('raw'), dict) else payload,
                }
            ]
        )
    return normalized


def _extract_device(row):
    if not isinstance(row, dict):
        return None

    def first(*keys):
        for key in keys:
            value = _clean(row.get(key))
            if value:
                return value
        return ''

    device_name = first('name', 'device_name', 'computer_name', 'u_hardware_1.name', 'display_name')
    if not device_name:
        return None

    return {
        'id': first('asset_tag', 'serial_number', 'id', 'sys_id') or device_name,
        'name': device_name,
        'location': first('location', 'site', 'u_hardware_1.location'),
        'status': first('install_status', 'status', 'u_hardware_1.install_status') or 'Unknown',
        'assigned_to': first('assigned_to', 'owner', 'device_owner', 'user_name', 'u_hardware_1.assigned_to'),
        'asset_tag': first('asset_tag', 'u_hardware_1.asset_tag'),
        'serial_number': first('serial_number', 'u_hardware_1.serial_number'),
        'ip': first('ip_address', 'ip', 'u_hardware_1.ip_address'),
        'model': first('model', 'model_category', 'u_hardware_1.model_category'),
        'manufacturer': first('manufacturer', 'u_hardware_1.manufacturer'),
        'department': first('department', 'u_hardware_1.department'),
        'last_seen': first('last_discovered', 'u_hardware_1.last_discovered'),
    }


def _match_devices(opid, name, email):
    candidates = {item.lower() for item in (_clean(opid), _clean(name), _clean(email)) if item}
    if not candidates:
        return []

    rows = []
    for source_key in ('hardware_inventory', 'hardware', 'devices', 'hardware_rmr', 'ref_hardware'):
        source_rows = get_source(source_key, normalized=True)
        if isinstance(source_rows, list) and source_rows:
            rows.extend(source_rows)

    devices = []
    seen = set()
    for row in rows:
        device = _extract_device(row)
        if device is None:
            continue

        owner_blob = ' '.join(
            [
                _clean(device.get('assigned_to')),
                _clean(row.get('owner')),
                _clean(row.get('device_owner')),
                _clean(row.get('assigned_to')),
                _clean(row.get('user_name')),
                _clean(row.get('name')),
            ]
        ).lower()

        if not any(candidate in owner_blob for candidate in candidates):
            continue

        dedupe_key = (_clean(device.get('id')) or _clean(device.get('name'))).lower()
        if not dedupe_key or dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        devices.append(device)

    return devices


def resolve_user(identifier: str) -> dict:
    normalized = _clean(identifier).lower()
    if not normalized:
        return {'opid': '', 'name': '', 'email': ''}

    if OPID_PATTERN.fullmatch(normalized):
        cached = _load_cached_profile(normalized)
        return {
            'opid': normalized,
            'name': _clean(cached.get('display_name') or cached.get('name')) or normalized,
            'email': _clean(cached.get('email')),
        }

    matched = _find_user_in_sources(normalized)
    if matched is None:
        return {'opid': '', 'name': _clean(identifier), 'email': ''}

    return {
        'opid': _clean(matched.get('opid')).lower(),
        'name': _clean(matched.get('name')) or _clean(identifier),
        'email': _clean(matched.get('email')),
    }


def get_user_devices(identifier: str, *, name: str = '', email: str = '') -> dict:
    normalized_identifier = _clean(identifier)
    resolved_user = resolve_user(normalized_identifier)
    resolved_opid = _clean(resolved_user.get('opid')).lower()
    if not resolved_opid:
        return {'user': {'opid': '', 'name': _clean(name) or normalized_identifier, 'email': _clean(email)}, 'devices': []}

    cached_profile = _load_cached_profile(resolved_opid)
    resolved_name = (
        _clean(name)
        or _clean(resolved_user.get('name'))
        or _clean(cached_profile.get('display_name') or cached_profile.get('name'))
        or resolved_opid
    )
    resolved_email = (
        _clean(email)
        or _clean(resolved_user.get('email'))
        or _clean(cached_profile.get('email'))
    )

    return {
        'user': {
            'opid': resolved_opid,
            'name': resolved_name,
            'email': resolved_email,
        },
        'devices': _match_devices(resolved_opid, resolved_name, resolved_email),
    }


def get_user_full_context(opid: str, *, user_id=None, refresh=False) -> dict:
    normalized_opid = _clean(opid).lower()
    if not normalized_opid:
        return {'profile': {}, 'groups': [], 'devices': []}

    now = _now_utc()
    cached = _CONTEXT_CACHE.get(normalized_opid)
    if (
        not refresh
        and cached
        and isinstance(cached.get('expires_at'), datetime)
        and cached['expires_at'] > now
    ):
        return cached.get('data') or {'profile': {}, 'groups': [], 'devices': []}

    profile = _load_cached_profile(normalized_opid)
    if refresh or not _clean(profile.get('display_name') or profile.get('email')):
        flow_profile = _run_profile_flow(normalized_opid, user_id=user_id)
        if flow_profile:
            profile = {
                **profile,
                'opid': normalized_opid,
                'display_name': _clean(flow_profile.get('display_name')) or _clean(profile.get('display_name')),
                'name': _clean(flow_profile.get('display_name')) or _clean(profile.get('name')),
                'email': _clean(flow_profile.get('email')) or _clean(profile.get('email')),
                'job_title': _clean(flow_profile.get('job_title')) or _clean(profile.get('job_title')),
                'department': _clean(flow_profile.get('department')) or _clean(profile.get('department')),
                'location': _clean(flow_profile.get('location')) or _clean(profile.get('location')),
                'account_enabled': flow_profile.get('account_enabled')
                if flow_profile.get('account_enabled') is not None
                else profile.get('account_enabled'),
            }

    groups_payload = get_user_groups_via_flow(normalized_opid, user_id=user_id)
    groups = groups_payload.get('items') if isinstance(groups_payload, dict) else []
    if not isinstance(groups, list):
        groups = []

    display_name = _clean(profile.get('display_name') or profile.get('name')) or normalized_opid
    email = _clean(profile.get('email'))
    devices = _match_devices(normalized_opid, display_name, email)

    result = {
        'profile': profile,
        'groups': groups,
        'devices': devices,
    }

    _CONTEXT_CACHE[normalized_opid] = {
        'data': result,
        'expires_at': now + timedelta(seconds=CONTEXT_CACHE_TTL_SECONDS),
    }
    return result
