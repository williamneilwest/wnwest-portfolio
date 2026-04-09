import os
import socket
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http import HTTPStatus


def _probe_json(url, headers=None):
    try:
        request = urllib.request.Request(url, headers=headers or {})

        with urllib.request.urlopen(request, timeout=2) as response:
            payload = response.read().decode()
            return {
                'status': 'ok' if response.status < HTTPStatus.BAD_REQUEST else 'degraded',
                'httpStatus': response.status,
                'body': payload,
            }
    except (urllib.error.URLError, TimeoutError, socket.timeout) as error:
        return {
            'status': 'down',
            'error': str(getattr(error, 'reason', error)),
        }


def _probe_frontend(url):
    try:
        request = urllib.request.Request(url, headers={'Host': 'westos.dev'})

        with urllib.request.urlopen(request, timeout=2) as response:
            return {
                'status': 'ok' if response.status < HTTPStatus.BAD_REQUEST else 'degraded',
                'httpStatus': response.status,
            }
    except (urllib.error.URLError, TimeoutError, socket.timeout) as error:
        return {
            'status': 'down',
            'error': str(getattr(error, 'reason', error)),
        }


def build_system_status():
    environment = os.getenv('FLASK_ENV', 'production')
    ai_url = os.getenv('AI_GATEWAY_STATUS_URL', 'http://ai-gateway:5001/ai/health')
    frontend_url = os.getenv('FRONTEND_STATUS_URL', 'http://frontend:5173')

    backend_probe = {
        'status': 'ok',
        'source': 'local',
    }
    ai_probe = _probe_json(ai_url)
    frontend_probe = _probe_frontend(frontend_url)

    return {
        'backend': backend_probe['status'],
        'ai_gateway': ai_probe['status'],
        'frontend': frontend_probe['status'],
        'environment': environment,
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'details': {
            'backend': backend_probe,
            'ai_gateway': ai_probe,
            'frontend': frontend_probe,
        },
    }
