import os
import socket
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http import HTTPStatus
from time import perf_counter

from flask import current_app


def _probe_json(url, headers=None):
    started_at = perf_counter()
    try:
        request = urllib.request.Request(url, headers=headers or {})

        with urllib.request.urlopen(request, timeout=2) as response:
            payload = response.read().decode()
            return {
                'status': 'ok' if response.status < HTTPStatus.BAD_REQUEST else 'degraded',
                'httpStatus': response.status,
                'body': payload,
                'responseTimeMs': round((perf_counter() - started_at) * 1000, 2),
            }
    except urllib.error.HTTPError as error:
        return {
            'status': 'misconfigured',
            'httpStatus': getattr(error, 'code', None),
            'error': str(error),
            'responseTimeMs': round((perf_counter() - started_at) * 1000, 2),
        }
    except (urllib.error.URLError, TimeoutError, socket.timeout) as error:
        return {
            'status': 'down',
            'error': str(getattr(error, 'reason', error)),
            'responseTimeMs': round((perf_counter() - started_at) * 1000, 2),
        }


def _probe_frontend(url):
    started_at = perf_counter()
    try:
        request = urllib.request.Request(url, headers={'Host': 'westos.dev'})

        with urllib.request.urlopen(request, timeout=2) as response:
            return {
                'status': 'ok' if response.status < HTTPStatus.BAD_REQUEST else 'degraded',
                'httpStatus': response.status,
                'responseTimeMs': round((perf_counter() - started_at) * 1000, 2),
            }
    except urllib.error.HTTPError as error:
        return {
            'status': 'misconfigured',
            'httpStatus': getattr(error, 'code', None),
            'error': str(error),
            'responseTimeMs': round((perf_counter() - started_at) * 1000, 2),
        }
    except (urllib.error.URLError, TimeoutError, socket.timeout) as error:
        return {
            'status': 'down',
            'error': str(getattr(error, 'reason', error)),
            'responseTimeMs': round((perf_counter() - started_at) * 1000, 2),
        }


def build_system_status():
    environment = os.getenv('FLASK_ENV', 'production')
    ai_url = os.getenv('AI_GATEWAY_STATUS_URL', 'http://ai-gateway:5001/health')
    frontend_build_dir = str(current_app.config.get('FRONTEND_BUILD_DIR') or '').strip()

    backend_probe = {
        'status': 'ok',
        'source': 'local',
    }
    ai_probe = _probe_json(ai_url)
    if frontend_build_dir:
        index_path = os.path.join(frontend_build_dir, 'index.html')
        frontend_probe = {
            'status': 'ok' if os.path.isfile(index_path) else 'misconfigured',
            'source': 'backend-static',
            'path': frontend_build_dir,
        }
    else:
        frontend_probe = {
            'status': 'misconfigured',
            'source': 'backend-static',
            'error': 'FRONTEND_BUILD_DIR is not configured.',
        }

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
