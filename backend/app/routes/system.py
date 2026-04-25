from flask import Blueprint, jsonify, request

from ..api_response import success_response
from ..services.auth_store import get_auth_summary
from ..services.regression_service import run_regression_check
from ..services.system_aggregator import build_system_map
from ..services.system_metrics import build_system_status
from ..services.system_validator import run_system_validation
from ..utils.deprecation import log_deprecated_route

system_bp = Blueprint('system', __name__)


@system_bp.get('/flows/system/status')
@system_bp.get('/api/system/status')
def system_status():
    if request.path == '/flows/system/status':
        log_deprecated_route('/flows/system/status', '/api/system/status')

    return success_response(build_system_status())


@system_bp.get('/api/system/services')
def system_services():
    force_refresh = str(request.args.get('refresh') or '').strip().lower() in {'1', 'true', 'yes'}
    payload = build_system_map(force_refresh=force_refresh)
    return success_response(payload.get('services', {}))


@system_bp.get('/api/system/features')
def system_features():
    force_refresh = str(request.args.get('refresh') or '').strip().lower() in {'1', 'true', 'yes'}
    payload = build_system_map(force_refresh=force_refresh)
    return success_response(payload.get('features', []))


@system_bp.get('/api/system/datasets')
def system_datasets():
    force_refresh = str(request.args.get('refresh') or '').strip().lower() in {'1', 'true', 'yes'}
    payload = build_system_map(force_refresh=force_refresh)
    return success_response(payload.get('datasets', {}))


@system_bp.get('/api/system/ai')
def system_ai():
    force_refresh = str(request.args.get('refresh') or '').strip().lower() in {'1', 'true', 'yes'}
    payload = build_system_map(force_refresh=force_refresh)
    return success_response(payload.get('ai', {}))


@system_bp.get('/api/system/auth')
def system_auth():
    try:
        window_hours = int(request.args.get('windowHours') or 24)
    except (TypeError, ValueError):
        window_hours = 24
    return success_response(get_auth_summary(window_hours=window_hours))


@system_bp.get('/api/system/map')
def system_map():
    force_refresh = str(request.args.get('refresh') or '').strip().lower() in {'1', 'true', 'yes'}
    return success_response(build_system_map(force_refresh=force_refresh))


@system_bp.get('/api/system/validate')
def system_validate():
    # Validation response shape is consumed directly by the System Viewer health panel.
    return jsonify(run_system_validation())


@system_bp.get('/api/system/regression')
def system_regression():
    return jsonify(run_regression_check())
