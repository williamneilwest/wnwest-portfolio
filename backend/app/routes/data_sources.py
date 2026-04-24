import re
import time
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, jsonify, request
from sqlalchemy import func, or_, text

from ..models.data_sources import DataSource, DataSourceVersion
from ..models.platform import SessionLocal, init_platform_db
from ..models.reference import Group as ReferenceGroup
from ..models.reference import SessionLocal as ReferenceSessionLocal
from ..models.reference import UserGroup as ReferenceUserGroup
from ..models.reference import User as ReferenceUser
from ..routes.email_upload import save_uploaded_attachment
from ..services.authz import get_current_user, require_admin, require_auth
from ..services.data_sources.cache import clear_cached
from ..services.data_sources.manager import get_source
from ..services.data_sources.normalizers import compute_file_checksum, count_rows, normalize, normalize_source_name
from ..services.data_source_service import register_source
from ..services.flow_ingest_service import upsert_users
from ..services.group_lookup import call_search_groups_flow, upsert_groups
from ..services.flow_templates import list_flow_templates, run_flow_template
from ..utils.flow_normalizer import normalize_user_profile_response


data_sources_bp = Blueprint('data_sources', __name__)

RESERVED_DATA_SOURCE_NAMES = {'upload', 'tools', 'files', 'promote'}
PROTECTED_SOURCE_KEYS = {'users', 'groups'}
PROTECTED_TABLES = {'ref_users', 'ref_groups', 'ref_user_groups'}
PEOPLESOFT_BACKUP_SOURCE_NAME = 'u_users__peoplesoft_locations'


def _utc_now():
    return datetime.now(timezone.utc)


def _activate_source_version(
    session,
    *,
    candidate: Path,
    source: DataSource | None = None,
    source_name: str = '',
    source_type: str = 'csv',
    schema_version: str | None = None,
    source_role: str = '',
) -> tuple[DataSource, DataSourceVersion]:
    if source is None:
        normalized_source_name = normalize_source_name(source_name)
        if not normalized_source_name:
            raise ValueError('name is required.')
        if normalized_source_name in RESERVED_DATA_SOURCE_NAMES:
            raise ValueError('name conflicts with a reserved API segment.')

        source = session.query(DataSource).filter_by(name=normalized_source_name).first()
        if source is None:
            source = DataSource(
                key=normalized_source_name,
                name=normalized_source_name,
                display_name=normalized_source_name.replace('_', ' ').title(),
                table_name=normalized_source_name,
                row_count=0,
                type=source_type,
                role=source_role or normalized_source_name,
                is_global=True,
                schema_version=schema_version,
                created_at=_utc_now(),
                updated_at=_utc_now(),
                last_updated=_utc_now(),
            )
            session.add(source)
            session.flush()
        else:
            source.type = source_type or source.type
            source.schema_version = schema_version or source.schema_version
            if source_role:
                source.role = source_role
    else:
        source.type = source_type or source.type
        source.schema_version = schema_version or source.schema_version
        if source_role:
            source.role = source_role

    session.query(DataSourceVersion).filter(
        DataSourceVersion.source_id == source.id,
        DataSourceVersion.is_active.is_(True),
    ).update({'is_active': False}, synchronize_session=False)

    version = DataSourceVersion(
        source_id=int(source.id),
        file_path=str(candidate),
        row_count=count_rows(str(candidate)),
        created_at=_utc_now(),
        is_active=True,
        checksum=compute_file_checksum(str(candidate)),
    )
    session.add(version)
    session.flush()

    source.active_version_id = int(version.id)
    source.key = source.key or source.name
    source.display_name = source.display_name or source.name
    source.table_name = source.table_name or source.name
    source.row_count = int(version.row_count or 0)
    source.updated_at = _utc_now()
    source.last_updated = _utc_now()
    return source, version


def _as_bool(value, default=True):
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in {'1', 'true', 'yes', 'y', 'on'}:
        return True
    if normalized in {'0', 'false', 'no', 'n', 'off'}:
        return False
    return default


def _serialize_source(source: DataSource, version: DataSourceVersion | None) -> dict:
    key = str(source.key or source.name or "").strip()
    rows = int(source.row_count or (version.row_count if version is not None else 0) or 0)
    table_name = str(source.table_name or source.name or "").strip()
    updated = source.updated_at or source.last_updated
    return {
        'id': int(source.id),
        'key': key,
        'name': source.name,
        'display_name': source.display_name or source.name,
        'table_name': table_name,
        'row_count': rows,
        'type': source.type,
        'role': source.role,
        'is_global': bool(source.is_global),
        'schema_version': source.schema_version,
        'updated_at': updated.isoformat() if updated else None,
        'created_at': source.created_at.isoformat() if getattr(source, 'created_at', None) else None,
        'last_updated': source.last_updated.isoformat() if source.last_updated else None,
        'active_version_id': int(source.active_version_id) if source.active_version_id else None,
        'active_version': (
            {
                'id': int(version.id),
                'file_path': version.file_path,
                'row_count': int(version.row_count or 0),
                'created_at': version.created_at.isoformat() if version.created_at else None,
                'is_active': bool(version.is_active),
                'checksum': version.checksum or '',
            }
            if version is not None else None
        ),
    }


def _search_users_from_source(query: str, limit: int = 20) -> list[dict]:
    users = _load_users_source_rows()
    results = []

    for user in users:
        if not isinstance(user, dict):
            continue

        user_id = str(user.get('opid') or user.get('user_id') or user.get('id') or '').strip()
        name = _extract_person_name(user)
        email = str(user.get('email') or user.get('mail') or '').strip()

        if query in user_id.lower() or query in name.lower() or query in email.lower():
            results.append({
                'opid': user_id,
                'name': name,
                'email': email,
            })

        if len(results) >= max(1, int(limit or 20)):
            break

    return results


def _extract_source_user_row(user: dict) -> dict | None:
    if not isinstance(user, dict):
        return None
    opid = _read_first_value(user, ('user_user_name', 'opid', 'user_id', 'id', 'employee_id', 'emplid'))
    if not opid:
        return None
    return {
        'opid': opid,
        'name': _extract_person_name(user),
        'display_name': _extract_person_name(user),
        'email': _read_first_value(
            user,
            ('email', 'email_address', 'work_email', 'mail', 'user_principal_name', 'userprincipalname'),
        ),
        'title': _read_first_value(user, ('title', 'job_title', 'position_title')),
        'department': str(user.get('department') or '').strip(),
        'location': str(user.get('location') or '').strip(),
        'physician': _read_first_value(user, ('u_physician', 'physician', 'user_u_physician')),
        'cost_center': _read_first_value(user, ('cost_center', 'user_cost_center')),
        'manager': _read_first_value(
            user,
            ('manager', 'u_manager', 'user_manager', 'manager_name', 'cost_center_manager_name'),
        ),
        'director': _read_first_value(
            user,
            ('u_director', 'director', 'user_u_director', 'director_name'),
        ),
        'source': str(user.get('source') or 'users_master').strip() or 'users_master',
    }


def _query_users_source_table(query: str, limit: int = 200) -> list[dict]:
    users = _load_users_source_rows()
    normalized_query = str(query or '').strip().lower()
    capped_limit = max(1, min(int(limit or 200), 500))
    results = []

    for user in users:
        row = _extract_source_user_row(user)
        if row is None:
            continue
        if normalized_query:
            opid = str(row.get('opid') or '').lower()
            name = str(row.get('name') or '').lower()
            email = str(row.get('email') or '').lower()
            if normalized_query not in opid and normalized_query not in name and normalized_query not in email:
                continue
        results.append(row)
        if len(results) >= capped_limit:
            break

    return results


def _read_first_value(row: dict, keys: tuple[str, ...]) -> str:
    if not isinstance(row, dict):
        return ''
    normalized_map = {}
    for raw_key, raw_value in row.items():
        normalized_key = re.sub(r'[^a-z0-9]+', '', str(raw_key or '').strip().lower())
        if normalized_key and normalized_key not in normalized_map:
            normalized_map[normalized_key] = raw_value
    for key in keys:
        value = row.get(key)
        if value is None:
            normalized_key = re.sub(r'[^a-z0-9]+', '', str(key or '').strip().lower())
            value = normalized_map.get(normalized_key)
        if value is None:
            continue
        cleaned = str(value).strip()
        if cleaned:
            return cleaned
    return ''


def _extract_person_name(row: dict) -> str:
    if not isinstance(row, dict):
        return ''

    primary_name = _read_first_value(
        row,
        (
            'name',
            'display_name',
            'full_name',
            'employee_name',
            'person_name',
            'preferred_name',
            'legal_name',
            'user_name',
        ),
    )
    if primary_name:
        return primary_name

    fallback_name = _read_first_value(row, ('user_name',))
    epic_group_name = _read_first_value(row, ('epic_group_name', 'epic_group', 'epic_security_group'))
    if fallback_name and epic_group_name and fallback_name.strip().lower() == epic_group_name.strip().lower():
        return ''
    return fallback_name


def _find_backup_users_source_name() -> str:
    rows = get_source(PEOPLESOFT_BACKUP_SOURCE_NAME, normalized=False)
    if isinstance(rows, list) and rows:
        return PEOPLESOFT_BACKUP_SOURCE_NAME
    return ''


def _extract_backup_people_row(row: dict) -> dict | None:
    if not isinstance(row, dict):
        return None

    opid = _read_first_value(row, ('user_user_name', 'user_name', 'opid', 'user_id', 'employee_id', 'emplid', 'network_id'))
    if not opid:
        return None

    person_name = _read_first_value(
        row,
        ('name', 'display_name', 'full_name', 'employee_name', 'person_name', 'preferred_name', 'legal_name', 'user_name'),
    )
    if not person_name:
        return None

    return {
        'opid': opid,
        'display_name': person_name,
        'name': person_name,
        'email': _read_first_value(row, ('user_email', 'email', 'email_address', 'mail', 'work_email', 'user_principal_name')),
        'job_title': _read_first_value(row, ('user_title', 'job_title', 'title', 'position_title')),
        'department': _read_first_value(row, ('user_department', 'department', 'dept', 'department_name')),
        'location': _read_first_value(
            row,
            ('user_location', 'user_u_peoplesoft_location', 'location', 'site', 'office_location', 'user_location.u_site.u_region'),
        ),
        'physician': _read_first_value(row, ('user_u_physician', 'u_physician', 'physician')),
        'cost_center': _read_first_value(row, ('user_cost_center', 'cost_center')),
        'manager': _read_first_value(
            row,
            ('user_manager', 'manager', 'u_manager', 'manager_name', 'cost_center_manager_name'),
        ),
        'director': _read_first_value(
            row,
            ('user_u_director', 'u_director', 'director', 'director_name'),
        ),
        'epic_group_name': _read_first_value(
            row,
            ('user_u_epic_assignment_group_name', 'user_u_epic_assignment_group.name', 'u_epic_assignment_group', 'epic_group_name', 'epic_group', 'epic_security_group'),
        ),
        'account_enabled': None,
        'source': PEOPLESOFT_BACKUP_SOURCE_NAME,
    }


def _search_backup_users(query: str, limit: int = 50) -> tuple[str, list[dict]]:
    normalized_query = str(query or '').strip().lower()
    if not normalized_query:
        return '', []

    source_name = _find_backup_users_source_name()
    if not source_name:
        return '', []

    rows = get_source(source_name, normalized=False)
    if not isinstance(rows, list) or not rows:
        return source_name, []

    capped_limit = max(1, min(int(limit or 50), 200))
    results = []
    for row in rows:
        parsed = _extract_backup_people_row(row)
        if parsed is None:
            continue

        searchable_values = [
            str(parsed.get('display_name') or '').strip().lower(),
            str(parsed.get('opid') or '').strip().lower(),
            str(parsed.get('email') or '').strip().lower(),
        ]
        if not any(normalized_query in candidate for candidate in searchable_values if candidate):
            continue
        results.append(parsed)
        if len(results) >= capped_limit:
            break

    return source_name, results


def _load_users_source_rows() -> list[dict]:
    # Prefer users_master source table when available.
    users = get_source('users_master', normalized=True)
    if isinstance(users, list) and users:
        return users

    # Fallback to canonical users source key if present.
    fallback_users = get_source('users', normalized=True)
    if isinstance(fallback_users, list) and fallback_users:
        return fallback_users

    # Final fallback: reference users table as source of truth.
    ref_session = ReferenceSessionLocal()
    try:
        rows = ref_session.query(ReferenceUser).all()
        result = []
        for row in rows:
            result.append({
                'opid': _read_user_attr(row, 'id'),
                'name': _read_user_attr(row, 'display_name') or _read_user_attr(row, 'name'),
                'display_name': _read_user_attr(row, 'display_name') or _read_user_attr(row, 'name'),
                'email': _read_user_attr(row, 'email'),
                'job_title': _read_user_attr(row, 'job_title'),
                'department': _read_user_attr(row, 'department'),
                'location': _read_user_attr(row, 'location'),
                'account_enabled': _read_user_attr(row, 'account_enabled'),
                'source': _read_user_attr(row, 'source') or 'ref_users',
            })
        return result
    finally:
        ref_session.close()


def _find_get_user_profile_template():
    templates = list_flow_templates()
    return next(
        (
            item for item in templates
            if 'get user profile' in str(item.get('display_name') or '').lower()
            or 'get_user_profile' in str(item.get('script_name') or '').lower()
        ),
        None,
    )


def call_get_user_profile_flow(username):
    normalized_username = str(username or '').strip().lower()
    if len(normalized_username) != 6 or not re.fullmatch(r'[a-z0-9]{6}', normalized_username):
        return None

    template = _find_get_user_profile_template()
    if not template or not template.get('id'):
        return None

    user = get_current_user()
    user_id = int(user.id) if user is not None else None
    run_payload = {
        'query': normalized_username,
        'username': normalized_username,
        'user_opid': normalized_username,
        'userOpid': normalized_username,
        'user_id': normalized_username,
    }

    try:
        data = run_flow_template(
            int(template['id']),
            run_payload,
            user_id=user_id,
        )
    except Exception:
        return None

    print("[USER PROFILE RAW]", data)
    profile = normalize_user_profile_response(data, normalized_username)
    print("[USER PROFILE NORMALIZED]", profile)
    return profile


def _safe_table_name(value: str) -> str:
    table_name = str(value or '').strip().lower()
    if not re.fullmatch(r'[a-z_][a-z0-9_]*', table_name):
        return ''
    return table_name


def _safe_column_name(value: str) -> str:
    column = str(value or '').strip().lower()
    if not re.fullmatch(r'[a-z_][a-z0-9_]*', column):
        return ''
    return column


def _session_for_table(table_name: str):
    if str(table_name or '').strip().lower().startswith('ref_'):
        return ReferenceSessionLocal()
    return SessionLocal()


def _delete_row_from_table(table_name: str, filters: dict) -> int:
    safe_table = _safe_table_name(table_name)
    if not safe_table:
        return 0
    if not isinstance(filters, dict):
        return 0

    normalized_filters = {}
    for key, value in filters.items():
        safe_key = _safe_column_name(key)
        if not safe_key:
            continue
        if isinstance(value, (dict, list, tuple, set)):
            continue
        normalized_filters[safe_key] = value

    if not normalized_filters:
        return 0

    # Normalized views may expose semantic keys instead of physical PK column `id`.
    if 'id' not in normalized_filters:
        if safe_table == 'ref_groups' and 'group_id' in normalized_filters:
            normalized_filters['id'] = normalized_filters.get('group_id')
        elif safe_table == 'ref_users':
            if 'opid' in normalized_filters:
                normalized_filters['id'] = normalized_filters.get('opid')
            elif 'user_id' in normalized_filters:
                normalized_filters['id'] = normalized_filters.get('user_id')

    # Prefer deterministic delete by id if provided.
    if 'id' in normalized_filters:
        normalized_filters = {'id': normalized_filters['id']}

    where_parts = []
    params = {}
    index = 0
    for key, value in normalized_filters.items():
        if value is None:
            where_parts.append(f'"{key}" IS NULL')
            continue
        placeholder = f'v_{index}'
        where_parts.append(f'"{key}" = :{placeholder}')
        params[placeholder] = value
        index += 1

    if not where_parts:
        return 0

    statement = f'DELETE FROM "{safe_table}" WHERE {" AND ".join(where_parts)}'
    session = _session_for_table(safe_table)
    try:
        result = session.execute(text(statement), params)
        deleted = int(getattr(result, 'rowcount', 0) or 0)
        session.commit()
        return deleted
    except Exception:
        session.rollback()
        return 0
    finally:
        session.close()


def _read_user_attr(user, field: str):
    value = getattr(user, field, None)
    if field == "account_enabled":
        if isinstance(value, bool):
            return value
        raw_bool = str(value or "").strip().lower()
        if raw_bool in {"true", "1", "yes", "y", "enabled"}:
            return True
        if raw_bool in {"false", "0", "no", "n", "disabled"}:
            return False
    elif value not in (None, ""):
        return str(value).strip()

    raw = getattr(user, "raw_json", None)
    if not isinstance(raw, dict):
        return ""

    key_variants = {
        "display_name": ("display_name", "displayName", "name", "Name", "Display Name"),
        "email": ("email", "Email", "mail", "userPrincipalName", "User Principal Name", "Email Address"),
        "job_title": ("job_title", "jobTitle", "title", "Job Title"),
        "department": ("department", "Department"),
        "location": ("location", "Location"),
        "account_enabled": ("account_enabled", "Account Enabled", "accountEnabled"),
    }.get(field, (field,))

    lowered = {str(k).strip().lower(): v for k, v in raw.items()}
    for key in key_variants:
        if key in raw and raw.get(key) not in (None, ""):
            if field == "account_enabled":
                return str(raw.get(key)).strip().lower() in {"true", "1", "yes", "y", "enabled"}
            return str(raw.get(key)).strip()
        lowered_value = lowered.get(str(key).strip().lower())
        if lowered_value not in (None, ""):
            if field == "account_enabled":
                return str(lowered_value).strip().lower() in {"true", "1", "yes", "y", "enabled"}
            return str(lowered_value).strip()

    return None if field == "account_enabled" else ""


def _serialize_user(user):
    if user is None:
        return None
    return {
        'opid': str(getattr(user, 'id', '') or '').strip().lower(),
        'display_name': _read_user_attr(user, 'display_name'),
        'email': _read_user_attr(user, 'email'),
        'job_title': _read_user_attr(user, 'job_title'),
        'department': _read_user_attr(user, 'department'),
        'location': _read_user_attr(user, 'location'),
        'account_enabled': _read_user_attr(user, 'account_enabled'),
        'source': str(getattr(user, 'source', '') or '').strip() or 'cache',
        'last_updated': user.updated_at.isoformat() if getattr(user, 'updated_at', None) else None,
    }


def _load_user_groups(session, user_id: str):
    normalized_user_id = str(user_id or '').strip().lower()
    if not normalized_user_id:
        return []

    links = (
        session.query(ReferenceUserGroup)
        .filter(ReferenceUserGroup.user_id == normalized_user_id)
        .all()
    )
    if not links:
        return []

    group_ids = [str(link.group_id or '').strip() for link in links if str(link.group_id or '').strip()]
    if not group_ids:
        return []

    groups = (
        session.query(ReferenceGroup)
        .filter(ReferenceGroup.id.in_(group_ids))
        .all()
    )
    group_map = {str(group.id or '').strip(): group for group in groups}
    results = []
    for gid in group_ids:
        group = group_map.get(gid)
        group_name = str(getattr(group, 'name', '') or '').strip() if group is not None else ''
        results.append({
            'id': gid,
            'name': group_name or None,
            'description': str(getattr(group, 'description', '') or '').strip() if group is not None else '',
            'enriched': bool(group is not None and group_name),
        })

    missing_ids = [item['id'] for item in results if not item.get('enriched')]
    if missing_ids:
        for group_id in missing_ids[:5]:
            try:
                flow_results = call_search_groups_flow(group_id)
                if isinstance(flow_results, list) and flow_results:
                    upsert_groups(flow_results)
            except Exception:
                continue

        session.expire_all()
        refreshed = (
            session.query(ReferenceGroup)
            .filter(ReferenceGroup.id.in_(group_ids))
            .all()
        )
        refreshed_map = {str(group.id or '').strip(): group for group in refreshed}
        for item in results:
            group = refreshed_map.get(item['id'])
            if group is None:
                continue
            group_name = str(getattr(group, 'name', '') or '').strip()
            if not group_name:
                continue
            item['name'] = group_name
            item['description'] = str(getattr(group, 'description', '') or '').strip()
            item['enriched'] = True

    return results


def _lookup_reference_user(session, username: str):
    normalized = str(username or "").strip()
    if not normalized:
        return None

    lowered = normalized.lower()
    exact = (
        session.get(ReferenceUser, normalized)
        or session.get(ReferenceUser, lowered)
        or session.get(ReferenceUser, normalized.upper())
    )
    if exact is not None:
        return exact

    return (
        session.query(ReferenceUser)
        .filter(
            or_(
                func.lower(ReferenceUser.id) == lowered,
                func.lower(ReferenceUser.email) == lowered,
                func.lower(ReferenceUser.email).like(f"{lowered}@%"),
                func.lower(ReferenceUser.name) == lowered,
                func.lower(ReferenceUser.display_name) == lowered,
            )
        )
        .first()
    )


def _fetch_table_preview(table_name: str, limit: int = 500) -> tuple[list[str], list[dict]]:
    safe_table = _safe_table_name(table_name)
    if not safe_table:
        return [], []

    capped_limit = max(1, min(int(limit or 500), 500))
    session = SessionLocal()
    try:
        result = session.execute(text(f'SELECT * FROM "{safe_table}" LIMIT :limit'), {'limit': capped_limit})
        columns = list(result.keys())
        rows = [dict(zip(columns, row)) for row in result.fetchall()]
        return columns, rows
    except Exception:
        return [], []
    finally:
        session.close()


def _resolve_source_table(source_key_or_name: str) -> tuple[str, str, str]:
    normalized = normalize_source_name(source_key_or_name)
    if not normalized:
        return "", "", ""

    init_platform_db()
    session = SessionLocal()
    try:
        source = _find_source_by_key_or_name(session, normalized)
        if source is not None:
            source_key = str(source.key or normalized).strip() or normalized
            source_name = str(source.display_name or source.name or normalized).strip() or normalized
            table_name = str(source.table_name or source.name or normalized).strip() or normalized
            return source_key, source_name, table_name
    finally:
        session.close()

    if normalized == 'users':
        return 'users', 'Users', 'ref_users'
    if normalized in {'groups', 'reference_groups'}:
        return 'groups', 'Groups', 'ref_groups'
    return normalized, normalized, normalized


def _fetch_record_from_table(table_name: str, record_id: str) -> dict | None:
    safe_table = _safe_table_name(table_name)
    if not safe_table:
        return None

    identifier = str(record_id or '').strip()
    if not identifier:
        return None

    session = _session_for_table(table_name)
    try:
        columns_result = session.execute(text(f'SELECT * FROM "{safe_table}" LIMIT 0'))
        available_columns = [str(column) for column in columns_result.keys()]
    except Exception:
        session.close()
        return None

    priority = ['id', 'opid', 'user_id', 'group_id']
    candidate_columns = []
    for column in priority:
        if column in available_columns and column not in candidate_columns:
            candidate_columns.append(column)
    for column in available_columns:
        lowered = str(column).strip().lower()
        if lowered.endswith('_id') and column not in candidate_columns:
            candidate_columns.append(column)
    for column in available_columns:
        if column not in candidate_columns:
            candidate_columns.append(column)

    try:
        for column in candidate_columns:
            safe_column = _safe_column_name(column)
            if not safe_column:
                continue
            result = session.execute(
                text(f'SELECT * FROM "{safe_table}" WHERE CAST("{safe_column}" AS TEXT) = :record_id LIMIT 1'),
                {'record_id': identifier},
            ).fetchone()
            if result is None:
                continue
            return dict(zip(result.keys(), result))
        return None
    except Exception:
        return None
    finally:
        session.close()


def _find_source_by_key_or_name(session, key_or_name: str) -> DataSource | None:
    normalized = normalize_source_name(key_or_name)
    if not normalized:
        return None
    source = session.query(DataSource).filter_by(key=normalized).first()
    if source is not None:
        return source
    return session.query(DataSource).filter_by(name=normalized).first()


def _ensure_reference_registry_entries():
    """
    Ensure canonical Users/Groups datasets are represented in the source registry.
    """
    try:
        ref_session = ReferenceSessionLocal()
        try:
            users_count = int(ref_session.query(ReferenceUser).count())
            groups_count = int(ref_session.query(ReferenceGroup).count())
        finally:
            ref_session.close()
    except Exception:
        return

    # Prune duplicate registry rows for canonical reference sources.
    init_platform_db()
    session = SessionLocal()
    try:
        duplicates = (
            session.query(DataSource)
            .filter(
                or_(
                    (func.lower(DataSource.table_name) == 'ref_groups') & (func.lower(DataSource.key) != 'groups'),
                    (func.lower(DataSource.table_name) == 'ref_users') & (func.lower(DataSource.key) != 'users'),
                )
            )
            .all()
        )
        for item in duplicates:
            session.delete(item)
        if duplicates:
            session.commit()
    finally:
        session.close()

    register_source(
        key='users',
        name='Users',
        table_name='ref_users',
        row_count=users_count,
    )
    register_source(
        key='groups',
        name='Groups',
        table_name='ref_groups',
        row_count=groups_count,
    )


def _apply_normalization_for_source(source_key: str, rows: list[dict], normalized: bool) -> tuple[list[str], list[dict]]:
    if not normalized:
        columns = list(rows[0].keys()) if rows and isinstance(rows[0], dict) else []
        return columns, rows

    normalized_rows = normalize(source_key, rows)
    columns = list(normalized_rows[0].keys()) if normalized_rows and isinstance(normalized_rows[0], dict) else []
    return columns, normalized_rows


@data_sources_bp.get('/api/data-sources')
def list_sources():
    auth_error = require_auth()
    if auth_error is not None:
        return auth_error

    init_platform_db()
    _ensure_reference_registry_entries()
    session = SessionLocal()
    try:
        sources = session.query(DataSource).order_by(DataSource.name.asc(), DataSource.id.asc()).all()
        items = []
        for source in sources:
            version = session.get(DataSourceVersion, int(source.active_version_id)) if source.active_version_id else None
            items.append(_serialize_source(source, version))
        registry = [
            {
                'key': item.get('key') or item.get('name'),
                'name': item.get('display_name') or item.get('name'),
                'table': item.get('table_name') or item.get('name'),
                'rows': int(item.get('row_count') or 0),
                'updated': item.get('updated_at') or item.get('last_updated'),
            }
            for item in items
        ]
        return jsonify({'success': True, 'items': items, 'sources': registry})
    finally:
        session.close()


@data_sources_bp.post('/api/data-sources/promote')
def promote_upload():
    admin_error = require_admin()
    if admin_error is not None:
        return admin_error

    payload = request.get_json(silent=True) or {}
    file_path = str(payload.get('file_path') or '').strip()
    source_name = normalize_source_name(payload.get('name'))
    source_type = str(payload.get('type') or 'csv').strip().lower() or 'csv'
    schema_version = str(payload.get('schema_version') or '').strip() or None
    source_role = normalize_source_name(payload.get('role'))

    if not file_path:
        return jsonify({'success': False, 'error': 'file_path is required.'}), 400
    if not source_name:
        return jsonify({'success': False, 'error': 'name is required.'}), 400
    if source_name in RESERVED_DATA_SOURCE_NAMES:
        return jsonify({'success': False, 'error': 'name conflicts with a reserved API segment.'}), 400

    candidate = Path(file_path).expanduser()
    if not candidate.exists() or not candidate.is_file():
        return jsonify({'success': False, 'error': 'file_path does not exist.'}), 400

    init_platform_db()
    session = SessionLocal()
    try:
        source, version = _activate_source_version(
            session,
            candidate=candidate,
            source_name=source_name,
            source_type=source_type,
            schema_version=schema_version,
            source_role=source_role,
        )
        session.commit()

        clear_cached(source.name)
        clear_cached(source.key)
        register_source(
            key=source.key or source.name,
            name=source.display_name or source.name,
            table_name=source.table_name or source.name,
            row_count=int(version.row_count or 0),
        )
        return jsonify({'success': True, 'status': 'ok', 'source': _serialize_source(source, version)})
    finally:
        session.close()


@data_sources_bp.post('/api/data-sources/<int:source_id>/replace-file')
def replace_source_file(source_id: int):
    admin_error = require_admin()
    if admin_error is not None:
        return admin_error

    uploaded_file = request.files.get('file')
    if uploaded_file is None or not uploaded_file.filename:
        return jsonify({'success': False, 'error': 'A file is required.'}), 400

    saved_record = save_uploaded_attachment(uploaded_file, source='data-source-refresh')
    candidate = Path(str(saved_record.get('path') or '')).expanduser()
    if not candidate.exists() or not candidate.is_file():
        return jsonify({'success': False, 'error': 'Uploaded file could not be saved.'}), 400

    schema_version = str(request.form.get('schema_version') or '').strip() or None
    source_type = str(request.form.get('type') or 'csv').strip().lower() or 'csv'

    init_platform_db()
    session = SessionLocal()
    try:
        source = session.get(DataSource, int(source_id))
        if source is None:
            return jsonify({'success': False, 'error': 'Source not found.'}), 404

        source, version = _activate_source_version(
            session,
            candidate=candidate,
            source=source,
            source_type=source_type,
            schema_version=schema_version,
            source_role=str(source.role or '').strip(),
        )
        session.commit()

        clear_cached(source.name)
        clear_cached(source.key)
        register_source(
            key=source.key or source.name,
            name=source.display_name or source.name,
            table_name=source.table_name or source.name,
            row_count=int(version.row_count or 0),
        )
        return jsonify({
            'success': True,
            'status': 'ok',
            'source': _serialize_source(source, version),
            'upload': saved_record,
        })
    finally:
        session.close()


@data_sources_bp.get('/api/data/<name>')
def get_source_data(name: str):
    auth_error = require_auth()
    if auth_error is not None:
        return auth_error

    normalized = normalize_source_name(name)
    if not normalized or normalized in RESERVED_DATA_SOURCE_NAMES:
        return jsonify({'success': False, 'error': 'Invalid source name.'}), 400

    normalized_view = _as_bool(request.args.get('normalized'), default=True)
    rows = get_source(normalized, normalized=normalized_view)
    resolved_table_name = normalized
    columns = list(rows[0].keys()) if rows and isinstance(rows[0], dict) else []
    if not rows:
        init_platform_db()
        session = SessionLocal()
        try:
            source = _find_source_by_key_or_name(session, normalized)
            if source is not None:
                table_name = str(source.table_name or source.name or normalized).strip()
            elif normalized == 'users':
                table_name = 'ref_users'
            elif normalized in {'groups', 'reference_groups'}:
                table_name = 'ref_groups'
            else:
                table_name = normalized
            resolved_table_name = table_name
        finally:
            session.close()
        table_columns, table_rows = _fetch_table_preview(table_name, limit=500)
        if table_rows:
            rows = table_rows
            columns, rows = _apply_normalization_for_source(normalized, rows, normalized_view)
        else:
            columns = table_columns
    register_source(
        key=normalized,
        name=normalized.replace('_', ' ').title(),
        table_name=resolved_table_name,
        row_count=len(rows),
    )
    return jsonify({
        'success': True,
        'name': normalized,
        'normalized': normalized_view,
        'columns': columns,
        'rows': rows[:500],
        'items': rows,
        'count': len(rows),
    })


@data_sources_bp.patch('/api/data-sources/<int:source_id>')
def update_source(source_id: int):
    admin_error = require_admin()
    if admin_error is not None:
        return admin_error

    payload = request.get_json(silent=True) or {}
    role_input = payload.get('role')
    key_input = payload.get('key')
    display_name_input = payload.get('source_name')
    if display_name_input is None:
        display_name_input = payload.get('display_name')

    has_role = role_input is not None
    has_key = key_input is not None
    has_display_name = display_name_input is not None

    if not (has_role or has_key or has_display_name):
        return jsonify({'success': False, 'error': 'At least one of role, key, or source_name is required.'}), 400

    role = normalize_source_name(role_input) if has_role else None
    if has_role and not role:
        return jsonify({'success': False, 'error': 'role is invalid.'}), 400

    normalized_key = normalize_source_name(key_input) if has_key else None
    if has_key and not normalized_key:
        return jsonify({'success': False, 'error': 'key is invalid.'}), 400
    if normalized_key in RESERVED_DATA_SOURCE_NAMES:
        return jsonify({'success': False, 'error': 'key conflicts with a reserved API segment.'}), 400

    display_name = str(display_name_input or '').strip() if has_display_name else None
    if has_display_name and not display_name:
        return jsonify({'success': False, 'error': 'source_name cannot be empty.'}), 400

    init_platform_db()
    session = SessionLocal()
    try:
        source = session.get(DataSource, int(source_id))
        if source is None:
            return jsonify({'success': False, 'error': 'Source not found.'}), 404

        if has_key:
            existing_key = (
                session.query(DataSource)
                .filter(func.lower(DataSource.key) == normalized_key, DataSource.id != int(source.id))
                .first()
            )
            existing_name = (
                session.query(DataSource)
                .filter(func.lower(DataSource.name) == normalized_key, DataSource.id != int(source.id))
                .first()
            )
            if existing_key is not None or existing_name is not None:
                return jsonify({'success': False, 'error': 'key already exists.'}), 400
            source.key = normalized_key
            source.name = normalized_key

        if has_display_name:
            source.display_name = display_name

        if has_role:
            source.role = role

        source.last_updated = _utc_now()
        session.commit()

        clear_cached(source.name)
        clear_cached(source.key)
        version = session.get(DataSourceVersion, int(source.active_version_id)) if source.active_version_id else None
        return jsonify({'success': True, 'source': _serialize_source(source, version)})
    finally:
        session.close()


@data_sources_bp.delete('/api/data-sources/<int:source_id>')
def delete_source(source_id: int):
    admin_error = require_admin()
    if admin_error is not None:
        return admin_error

    init_platform_db()
    session = SessionLocal()
    try:
        source = session.get(DataSource, int(source_id))
        if source is None:
            return jsonify({'success': False, 'error': 'Source not found.'}), 404

        source_key = str(source.key or source.name or '').strip().lower()
        source_name = str(source.display_name or source.name or source_key).strip() or source_key
        table_name = str(source.table_name or source.name or '').strip().lower()
        safe_table = _safe_table_name(table_name)

        if source_key in PROTECTED_SOURCE_KEYS or safe_table in PROTECTED_TABLES:
            return jsonify({'success': False, 'error': 'This core source cannot be removed.'}), 400

        drop_table = _as_bool(request.args.get('drop_table'), default=True)
        if request.is_json:
            payload = request.get_json(silent=True) or {}
            if isinstance(payload, dict) and 'drop_table' in payload:
                drop_table = _as_bool(payload.get('drop_table'), default=drop_table)

        session.delete(source)
        session.commit()
    finally:
        session.close()

    table_dropped = False
    table_drop_error = ''
    if drop_table and safe_table and safe_table not in PROTECTED_TABLES:
        drop_session = SessionLocal()
        try:
            drop_session.execute(text(f'DROP TABLE IF EXISTS "{safe_table}"'))
            drop_session.commit()
            table_dropped = True
        except Exception as exc:
            drop_session.rollback()
            table_drop_error = str(exc)
        finally:
            drop_session.close()

    clear_cached(source_key or source_name)
    return jsonify({
        'success': True,
        'removed': {
            'id': int(source_id),
            'key': source_key,
            'name': source_name,
            'table_name': safe_table or table_name,
        },
        'table_dropped': table_dropped,
        'table_drop_error': table_drop_error or None,
    })


@data_sources_bp.get('/api/data-sources/<name>')
def get_source_preview(name: str):
    auth_error = require_auth()
    if auth_error is not None:
        return auth_error

    normalized = normalize_source_name(name)
    if not normalized or normalized in RESERVED_DATA_SOURCE_NAMES:
        return jsonify({'success': False, 'error': 'Invalid source name.'}), 400

    normalized_view = _as_bool(request.args.get('normalized'), default=True)
    rows = get_source(normalized, normalized=normalized_view)
    resolved_table_name = normalized
    columns = list(rows[0].keys()) if rows and isinstance(rows[0], dict) else []
    if not rows:
        init_platform_db()
        session = SessionLocal()
        try:
            source = _find_source_by_key_or_name(session, normalized)
            if source is not None:
                table_name = str(source.table_name or source.name or normalized).strip()
            elif normalized == 'users':
                table_name = 'ref_users'
            elif normalized in {'groups', 'reference_groups'}:
                table_name = 'ref_groups'
            else:
                table_name = normalized
            resolved_table_name = table_name
            source_name_for_response = str(source.display_name or source.name or normalized).strip() if source is not None else normalized
            source_key = str(source.key or normalized).strip() if source is not None else normalized
        finally:
            session.close()
        table_columns, table_rows = _fetch_table_preview(table_name, limit=500)
        if table_rows:
            rows = table_rows
            columns, rows = _apply_normalization_for_source(source_key, rows, normalized_view)
        else:
            columns = table_columns
            source_name_for_response = normalized
            source_key = normalized
    else:
        source_name_for_response = normalized
        source_key = normalized
    register_source(
        key=source_key,
        name=source_name_for_response,
        table_name=resolved_table_name,
        row_count=len(rows),
    )
    return jsonify({
        'success': True,
        'key': source_key,
        'name': source_name_for_response,
        'table': resolved_table_name,
        'rows_count': len(rows),
        'normalized': normalized_view,
        'columns': columns,
        'rows': rows[:500],
        'items': rows,
        'count': len(rows),
    })


@data_sources_bp.get('/api/data-sources/<source>/<record_id>')
def get_source_record(source: str, record_id: str):
    auth_error = require_auth()
    if auth_error is not None:
        return auth_error

    normalized = normalize_source_name(source)
    if not normalized or normalized in RESERVED_DATA_SOURCE_NAMES:
        return jsonify({'success': False, 'error': 'Invalid source name.'}), 400

    source_key, source_name, table_name = _resolve_source_table(normalized)
    if not table_name:
        return jsonify({'success': False, 'error': 'Source not found.'}), 404

    row = _fetch_record_from_table(table_name, record_id)
    if row is None:
        return jsonify({'success': False, 'error': 'Not found.'}), 404

    return jsonify({
        'success': True,
        'source': source_key or normalized,
        'name': source_name or normalized,
        'table': table_name,
        'record': row,
    })


@data_sources_bp.delete('/api/data-sources/<name>/rows')
def delete_source_row(name: str):
    admin_error = require_admin()
    if admin_error is not None:
        return admin_error

    normalized = normalize_source_name(name)
    if not normalized or normalized in RESERVED_DATA_SOURCE_NAMES:
        return jsonify({'success': False, 'error': 'Invalid source name.'}), 400

    payload = request.get_json(silent=True) or {}
    filters = payload.get('filters')
    if not isinstance(filters, dict) or not filters:
        return jsonify({'success': False, 'error': 'filters are required.'}), 400

    init_platform_db()
    session = SessionLocal()
    source_key = normalized
    source_name = normalized
    table_name = normalized
    try:
        source = _find_source_by_key_or_name(session, normalized)
        if source is not None:
            source_key = str(source.key or normalized).strip() or normalized
            source_name = str(source.display_name or source.name or normalized).strip() or normalized
            table_name = str(source.table_name or source.name or normalized).strip() or normalized
        elif normalized == 'users':
            table_name = 'ref_users'
            source_key = 'users'
            source_name = 'Users'
        elif normalized in {'groups', 'reference_groups'}:
            table_name = 'ref_groups'
            source_key = 'groups'
            source_name = 'Groups'
    finally:
        session.close()

    deleted = _delete_row_from_table(table_name, filters)
    if deleted <= 0:
        return jsonify({'success': False, 'error': 'No matching rows were deleted.'}), 404

    safe_table = _safe_table_name(table_name)
    if not safe_table:
        return jsonify({'success': False, 'error': 'Invalid source table.'}), 400

    session = _session_for_table(table_name)
    try:
        count_result = session.execute(text(f'SELECT COUNT(*) AS count FROM "{safe_table}"'))
        row_count = int(count_result.scalar() or 0)
    finally:
        session.close()

    register_source(
        key=source_key,
        name=source_name,
        table_name=table_name,
        row_count=row_count,
    )
    clear_cached(normalized)
    return jsonify({'success': True, 'deleted': deleted, 'row_count': row_count})


@data_sources_bp.get('/api/search-users')
def search_users():
    query = str(request.args.get('q') or '').strip().lower()
    if not query:
        return jsonify([])
    return jsonify(_search_users_from_source(query, limit=20))


@data_sources_bp.get('/api/users/search')
def users_search():
    query = str(request.args.get('name') or request.args.get('q') or '').strip().lower()
    if not query:
        return jsonify({'success': True, 'items': [], 'count': 0})

    results = _search_users_from_source(query, limit=20)
    return jsonify({'success': True, 'items': results, 'count': len(results)})


@data_sources_bp.get('/api/users-source')
def users_source_table():
    query = str(request.args.get('q') or '').strip()
    limit_raw = str(request.args.get('limit') or '200').strip()
    try:
        limit = max(1, min(int(limit_raw), 500))
    except ValueError:
        limit = 200

    items = _query_users_source_table(query, limit=limit)
    return jsonify({'success': True, 'query': query, 'count': len(items), 'items': items})


@data_sources_bp.get('/api/users-source/backup-search')
def users_source_backup_search():
    query = str(request.args.get('q') or '').strip()
    if len(query) < 2:
        return jsonify({'success': True, 'query': query, 'count': 0, 'items': [], 'source_name': ''})

    limit_raw = str(request.args.get('limit') or '50').strip()
    try:
        limit = max(1, min(int(limit_raw), 200))
    except ValueError:
        limit = 50

    source_name, items = _search_backup_users(query, limit=limit)
    if not items:
        source_name = source_name or 'users_master'
        items = _query_users_source_table(query, limit=limit)
    return jsonify({
        'success': True,
        'query': query,
        'count': len(items),
        'items': items,
        'source_name': source_name,
    })


@data_sources_bp.get('/api/search-users-live')
def search_users_live():
    auth_error = require_auth()
    if auth_error is not None:
        return auth_error

    query = str(request.args.get('q') or '').strip().lower()
    refresh = _as_bool(request.args.get('refresh'), default=False)
    if len(query) != 6 or not re.fullmatch(r'[a-z0-9]{6}', query):
        return jsonify([])

    if not refresh:
        results = _search_users_from_source(query, limit=20)
        if results:
            return jsonify(results)

    if not refresh:
        ref_session = ReferenceSessionLocal()
        try:
            cached_user = ref_session.get(ReferenceUser, query)
            if cached_user is not None:
                cached_name = _read_user_attr(cached_user, 'display_name')
                cached_email = _read_user_attr(cached_user, 'email')
                if cached_name or cached_email:
                    return jsonify([
                        {
                            'opid': query,
                            'display_name': cached_name or '',
                            'name': cached_name or '',
                            'email': cached_email or '',
                            'title': _read_user_attr(cached_user, 'job_title'),
                            'department': _read_user_attr(cached_user, 'department'),
                            'location': _read_user_attr(cached_user, 'location'),
                            'account_enabled': _read_user_attr(cached_user, 'account_enabled'),
                            'source': 'cache',
                        }
                    ])
        finally:
            ref_session.close()

    profile = call_get_user_profile_flow(query)
    if profile:
        upsert_users([
            {
                'opid': query,
                'display_name': profile.get('display_name'),
                'name': profile.get('display_name'),
                'email': profile.get('email'),
                'job_title': profile.get('job_title'),
                'department': profile.get('department'),
                'location': profile.get('location'),
                'account_enabled': profile.get('account_enabled'),
                'source': 'live_directory',
                'raw_json': profile.get('raw') if isinstance(profile.get('raw'), dict) else profile,
            }
        ])
        return jsonify([
            {
                'opid': query,
                'display_name': profile.get('display_name') or '',
                'name': profile.get('display_name') or '',
                'email': profile.get('email') or '',
                'title': profile.get('job_title') or '',
                'department': profile.get('department') or '',
                'location': profile.get('location') or '',
                'account_enabled': bool(profile.get('account_enabled')),
                'source': 'live_directory',
            }
        ])

    for _ in range(3):
        clear_cached('users_master')
        refreshed = _search_users_from_source(query, limit=20)
        if refreshed:
            return jsonify(refreshed)
        time.sleep(0.35)

    return jsonify([])


@data_sources_bp.get('/api/users/context/<username>')
def get_user_context(username: str):
    auth_error = require_auth()
    if auth_error is not None:
        return auth_error

    normalized_username = str(username or '').strip().lower()
    if not normalized_username:
        return jsonify({'success': False, 'error': 'username is required'}), 400
    if len(normalized_username) != 6 or not re.fullmatch(r'[a-z0-9]{6}', normalized_username):
        return jsonify({'success': False, 'error': 'Enter full OPID (6 characters)'}), 400

    ref_session = ReferenceSessionLocal()
    try:
        user = ref_session.get(ReferenceUser, normalized_username)
        should_fetch = (
            len(normalized_username) == 6
            and (
                user is None
                or not _read_user_attr(user, 'email')
                or not _read_user_attr(user, 'display_name')
            )
        )
        if should_fetch:
            profile = call_get_user_profile_flow(normalized_username)
            if profile:
                upsert_users([
                    {
                        'opid': normalized_username,
                        'display_name': profile.get('display_name'),
                        'name': profile.get('display_name'),
                        'email': profile.get('email'),
                        'job_title': profile.get('job_title'),
                        'department': profile.get('department'),
                        'location': profile.get('location'),
                        'account_enabled': profile.get('account_enabled'),
                        'source': 'live_directory',
                        'raw_json': profile.get('raw') if isinstance(profile.get('raw'), dict) else profile,
                    }
                ])
                ref_session.expire_all()
                user = ref_session.get(ReferenceUser, normalized_username)

        serialized = _serialize_user(user)
        groups = []
        if isinstance(serialized, dict):
            groups = _load_user_groups(ref_session, serialized.get('opid'))
            serialized['groups'] = groups
        return jsonify({
            'success': True,
            'user': serialized,
            'groups': groups,
            'group_count': len(groups),
        })
    finally:
        ref_session.close()
