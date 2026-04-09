from flask import Blueprint, current_app, jsonify

from ..services.system import build_health_payload

health_bp = Blueprint('health', __name__)


@health_bp.get('/health')
@health_bp.get('/api/health')
def health():
    return jsonify(build_health_payload(current_app.config['APP_NAME']))
