from flask import Blueprint

from ..api_response import success_response
from ..services.system_metrics import build_system_status

system_bp = Blueprint('system', __name__)


@system_bp.get('/flows/system/status')
@system_bp.get('/api/system/status')
def system_status():
    return success_response(build_system_status())
