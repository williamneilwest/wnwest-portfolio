from flask import Blueprint, current_app, jsonify, request

from ..models.reference import Endpoint, SessionLocal, init_db


endpoints_registry_bp = Blueprint('endpoints_registry', __name__)


def _display_name_from_endpoint(endpoint_name: str) -> str:
    if not endpoint_name:
        return 'Endpoint'
    # Convert dotted or underscored names to Title Case
    name = endpoint_name.replace('.', ' ').replace('_', ' ').strip()
    return name.title()


def _describe_view(endpoint_name: str) -> str:
    try:
        view = current_app.view_functions.get(endpoint_name)
        if view and view.__doc__:
            return view.__doc__.strip()
    except Exception:
        pass
    return ''


def sync_endpoints() -> dict:
    """Scan Flask app url_map and upsert into ref_endpoints.

    Returns a summary dict with counts.
    """
    init_db()
    created = 0
    updated = 0

    excluded = {'static'}
    endpoint_map = {}

    for rule in current_app.url_map.iter_rules():
        if rule.endpoint in excluded:
            continue

        methods = sorted(m for m in (rule.methods or []) if m not in {'HEAD', 'OPTIONS'})
        record = endpoint_map.setdefault(
            rule.endpoint,
            {
                'rules': set(),
                'methods': set(),
            },
        )
        record['rules'].add(str(rule.rule))
        record['methods'].update(methods or ['GET'])

    session = SessionLocal()
    try:
        for endpoint_id, record in endpoint_map.items():
            methods_str = ','.join(sorted(record['methods'])) or 'GET'
            rules_str = ' | '.join(sorted(record['rules']))
            display_name = _display_name_from_endpoint(endpoint_id)
            description = _describe_view(endpoint_id)

            existing = session.get(Endpoint, endpoint_id)
            if existing is None:
                session.add(
                    Endpoint(
                        id=endpoint_id,
                        name=display_name,
                        rule=rules_str,
                        methods=methods_str,
                        description=description,
                    )
                )
                created += 1
            else:
                changed = False
                if existing.name != display_name:
                    existing.name = display_name
                    changed = True
                if existing.rule != rules_str:
                    existing.rule = rules_str
                    changed = True
                if existing.methods != methods_str:
                    existing.methods = methods_str
                    changed = True
                # Only update description if empty or docstring present
                if description and existing.description != description:
                    existing.description = description
                    changed = True
                if changed:
                    updated += 1

        session.commit()
    finally:
        session.close()

    total = created + updated
    return {'success': True, 'created': created, 'updated': updated, 'total': total}


@endpoints_registry_bp.post('/api/reference/endpoints/sync')
def endpoints_sync_api():
    """Trigger a rescan of routes and update the master endpoints table."""
    summary = sync_endpoints()
    return jsonify(summary)


@endpoints_registry_bp.get('/api/reference/endpoints')
def list_endpoints_api():
    """List all known endpoints from the master table.

    If table is empty, attempt a background sync first.
    """
    init_db()
    session = SessionLocal()
    try:
        rows = session.query(Endpoint).order_by(Endpoint.name.asc()).all()
        if not rows:
            # Populate on first request to keep it effortless
            sync_endpoints()
            rows = session.query(Endpoint).order_by(Endpoint.name.asc()).all()

        return jsonify(
            [
                {
                    'id': row.id,
                    'name': row.name,
                    'rule': row.rule,
                    'methods': row.methods,
                    'description': row.description or '',
                }
                for row in rows
            ]
        )
    finally:
        session.close()
