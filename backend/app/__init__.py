import os
import atexit
from pathlib import Path
from collections import defaultdict, deque
from datetime import timedelta
from time import time

from flask import Flask, jsonify, request, send_from_directory, session
from dotenv import load_dotenv

from .routes.email_upload import email_upload_bp
from .routes import register_routes
from .services.log_monitor import get_log_monitor, shutdown_log_monitor


SPA_EXCLUDED_PREFIXES = (
    '/api/',
    '/flows/',
    '/uploads',
    '/auth/',
    '/plaid/',
    '/health',
)

WORK_ALLOWED_PREFIXES = (
    '/health',
    '/flows/work',
    '/api/work',
    '/api/ai',
    '/api/tickets',
    '/api/reference/groups',
    '/api/reference/users',
    '/api/kb',
    '/uploads',
    '/kb',
    '/api/email/upload',
    '/api/files',
    '/api/data/files',
    '/api/profile',
    '/api/flows',
)
PUBLIC_AUTH_PATH_PREFIX = '/api/auth/'
PUBLIC_WEBHOOK_PREFIXES = (
    '/webhooks/mailgun',
    '/webhooks/kb',
    '/api/email/upload',
)
PUBLIC_MUTATION_PREFIXES = (
    '/api/auth/',
    '/api/email/upload',
    '/webhooks/mailgun',
    '/webhooks/kb',
)
PUBLIC_WORK_VIEW_PREFIXES = (
    '/api/tickets',
    '/api/work/tickets',
    '/uploads',
    '/api/uploads',
    '/api/kb',
    '/kb',
    '/flows/work/recent-analyses',
)
AUTH_REQUIRED_PREFIXES = (
    '/api/data/',
    '/api/ai/',
    '/api/files',
    '/api/work/run',
    '/flows/work/analyze-csv',
    '/api/work/analyze-csv',
)
ADMIN_ONLY_PREFIXES = (
    '/api/admin',
    '/api/system/',
    '/api/console/',
    '/api/logs',
    '/api/services',
    '/api/reference/users',
    '/api/reference/endpoints/sync',
)

AUTH_RATE_WINDOW_SECONDS = 60
AUTH_RATE_MAX_ATTEMPTS = 20
_AUTH_RATE_BUCKETS = defaultdict(deque)


def _normalize_host(raw_host):
    return (raw_host or '').split(':', 1)[0].lower()


def _normalize_path(raw_path):
    return (raw_path or '/').rstrip('/') or '/'


def _path_matches_prefixes(request_path, prefixes):
    return any(
        request_path == prefix.rstrip('/') or request_path.startswith(f'{prefix.rstrip("/")}/')
        for prefix in prefixes
    )


def _is_work_domain_request(app, host):
    return host == app.config.get('WORK_DOMAIN', 'work.westos.dev')


def _is_public_non_work_path(request_path):
    return (
        request_path == '/health'
        or request_path.startswith(PUBLIC_AUTH_PATH_PREFIX)
        or _path_matches_prefixes(request_path, PUBLIC_WEBHOOK_PREFIXES)
    )


def _is_public_work_view_path(request_path, method):
    http_method = str(method or 'GET').upper()
    if http_method not in {'GET', 'HEAD'}:
        return False
    return _path_matches_prefixes(request_path, PUBLIC_WORK_VIEW_PREFIXES)


def _log_guard_decision(app, *, host, path, guard, action, reason):
    app.logger.info(
        'auth_guard decision guard=%s action=%s host=%s path=%s reason=%s',
        guard,
        action,
        host,
        path,
        reason,
    )
    if action != 'block':
        return

    try:
        from .services.auth_store import log_auth_event

        log_auth_event(
            username='anonymous',
            host=host,
            path=path,
            action=f'{guard}_blocked',
            reason=reason,
        )
    except Exception:
        # Guard persistence should never affect request handling.
        return


def _resolve_frontend_build_dir():
    configured = os.getenv('FRONTEND_BUILD_DIR', '').strip()
    candidates = []

    if configured:
        candidates.append(Path(configured))

    app_root = Path(__file__).resolve().parents[2]
    candidates.extend(
        [
            app_root / 'frontend' / 'dist',
            app_root.parent / 'frontend' / 'dist',
            Path('/app/frontend/dist'),
        ]
    )

    for candidate in candidates:
        if candidate.exists() and (candidate / 'index.html').exists():
            return candidate

    return None


def create_app():
    load_dotenv()
    frontend_build_dir = _resolve_frontend_build_dir()
    app = Flask(
        __name__,
        static_folder=str(frontend_build_dir) if frontend_build_dir else None,
        static_url_path='',
    )
    app.config.from_mapping(
        APP_NAME=os.getenv('APP_NAME', 'westOS API'),
        BACKEND_DATA_DIR=os.getenv('BACKEND_DATA_DIR', '/app/data'),
        USE_AI_GATEWAY=os.getenv('USE_AI_GATEWAY', 'true').lower() == 'true',
        AI_GATEWAY_BASE_URL=os.getenv('AI_GATEWAY_BASE_URL', 'http://ai-gateway:5001'),
        OLLAMA_API_BASE=os.getenv('OLLAMA_API_BASE', 'http://ollama:11434'),
        OLLAMA_MODEL=os.getenv('OLLAMA_MODEL', 'llama3.2'),
        LITELLM_MODEL=os.getenv('LITELLM_MODEL', 'ollama/llama3.2'),
        AVAILABLE_AI_MODELS=os.getenv('AVAILABLE_AI_MODELS', 'llama3.2,mistral,qwen2.5-coder'),
        OPENAI_API_KEY=os.getenv('OPENAI_API_KEY', ''),
        ENABLE_WEIGHTED_MATCHING=os.getenv('ENABLE_WEIGHTED_MATCHING', 'false').lower() == 'true',
        PREVIEW_MAX_ROWS=int(os.getenv('PREVIEW_MAX_ROWS', '10')),
        FOCUSED_MAX_ROWS=int(os.getenv('FOCUSED_MAX_ROWS', '5')),
        ENABLE_CHUNKING=os.getenv('ENABLE_CHUNKING', 'true').lower() == 'true',
        FRONTEND_BUILD_DIR=str(frontend_build_dir) if frontend_build_dir else '',
        ENABLE_LOG_MONITOR=os.getenv('ENABLE_LOG_MONITOR', 'true').lower() == 'true',
        DOCUMENT_PROCESSOR_MAX_FILE_BYTES=int(os.getenv('DOCUMENT_PROCESSOR_MAX_FILE_BYTES', str(15 * 1024 * 1024))),
        WORK_DOMAIN=os.getenv('WORK_DOMAIN', 'work.westos.dev').strip().lower(),
        DATABASE_URL=os.getenv('DATABASE_URL', '').strip(),
        SECRET_KEY=os.getenv('AUTH_SESSION_SECRET', os.getenv('SECRET_KEY', 'westos-session-secret')),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_SECURE=os.getenv('SESSION_COOKIE_SECURE', 'true').strip().lower() == 'true',
        PERMANENT_SESSION_LIFETIME=timedelta(days=7),
    )

    from .models.platform import init_platform_db
    from .services.auth_bootstrap import bootstrap_auth_user_from_env

    try:
        init_platform_db()
    except Exception as error:
        app.logger.warning('Failed to initialize platform database tables: %s', error)
    else:
        try:
            seeded = bootstrap_auth_user_from_env()
            if seeded is not None:
                app.logger.info('Seeded initial auth user: %s', seeded.username)
        except Exception as error:
            app.logger.warning('Failed to seed auth user from environment: %s', error)

    register_routes(app)
    app.register_blueprint(email_upload_bp)

    @app.before_request
    def limit_auth_bruteforce_attempts():
        request_path = _normalize_path(request.path)
        if not request_path.startswith('/api/auth/'):
            return None

        if request.method == 'OPTIONS':
            return None

        remote_ip = request.headers.get('X-Forwarded-For', request.remote_addr or '').split(',')[0].strip() or 'unknown'
        now = time()
        bucket = _AUTH_RATE_BUCKETS[remote_ip]
        while bucket and now - bucket[0] > AUTH_RATE_WINDOW_SECONDS:
            bucket.popleft()

        if len(bucket) >= AUTH_RATE_MAX_ATTEMPTS:
            _log_guard_decision(
                app,
                host=_normalize_host(request.host),
                path=request_path,
                guard='auth_rate_limit_guard',
                action='block',
                reason=f'rate_limited_ip={remote_ip}',
            )
            return ('Too Many Requests', 429)

        bucket.append(now)
        return None

    @app.before_request
    def restrict_non_work_routes_on_work_domain():
        host = _normalize_host(request.host)
        if not _is_work_domain_request(app, host):
            return None

        if request.method == 'OPTIONS':
            _log_guard_decision(
                app,
                host=host,
                path=_normalize_path(request.path),
                guard='work_domain_route_guard',
                action='allow',
                reason='preflight_options',
            )
            return None

        request_path = _normalize_path(request.path)
        is_allowed = _path_matches_prefixes(request_path, WORK_ALLOWED_PREFIXES)

        if is_allowed:
            _log_guard_decision(
                app,
                host=host,
                path=request_path,
                guard='work_domain_route_guard',
                action='allow',
                reason='work_route_whitelist',
            )
            return None

        _log_guard_decision(
            app,
            host=host,
            path=request_path,
            guard='work_domain_route_guard',
            action='block',
            reason='route_not_whitelisted_for_work_domain',
        )
        return ('Not Found', 404)

    @app.before_request
    def enforce_non_work_authentication():
        from .services.authz import RUN_AI, require_auth, require_permission, require_role

        host = _normalize_host(request.host)
        request_path = _normalize_path(request.path)
        if request.method == 'OPTIONS':
            return None

        if _path_matches_prefixes(request_path, ADMIN_ONLY_PREFIXES):
            auth_error = require_auth()
            if auth_error is not None:
                _log_guard_decision(
                    app,
                    host=host,
                    path=request_path,
                    guard='rbac_auth_guard',
                    action='block',
                    reason='admin_path_requires_auth',
                )
                return auth_error

            role_error = require_role('admin')
            if role_error is not None:
                _log_guard_decision(
                    app,
                    host=host,
                    path=request_path,
                    guard='rbac_role_guard',
                    action='block',
                    reason='admin_role_required',
                )
                return role_error

        elif _path_matches_prefixes(request_path, AUTH_REQUIRED_PREFIXES):
            auth_error = require_auth()
            if auth_error is not None:
                if request_path.startswith('/api/ai/'):
                    return jsonify({'error': 'Authentication required for AI actions'}), 401
                _log_guard_decision(
                    app,
                    host=host,
                    path=request_path,
                    guard='rbac_auth_guard',
                    action='block',
                    reason='execution_path_requires_auth',
                )
                return auth_error
            if request_path.startswith('/api/ai/'):
                permission_error = require_permission(RUN_AI)
                if permission_error is not None:
                    return jsonify({'error': 'Forbidden'}), 403

        if (
            request_path.startswith('/api/')
            and request.method.upper() not in {'GET', 'HEAD'}
            and not _path_matches_prefixes(request_path, PUBLIC_MUTATION_PREFIXES)
        ):
            auth_error = require_auth()
            if auth_error is not None:
                _log_guard_decision(
                    app,
                    host=host,
                    path=request_path,
                    guard='non_get_api_auth_guard',
                    action='block',
                    reason='non_get_api_requires_authentication',
                )
                return auth_error

        if _is_work_domain_request(app, host):
            return None

        if _is_public_non_work_path(request_path):
            _log_guard_decision(
                app,
                host=host,
                path=request_path,
                guard='non_work_auth_guard',
                action='allow',
                reason='public_path',
            )
            return None

        if _is_public_work_view_path(request_path, request.method):
            _log_guard_decision(
                app,
                host=host,
                path=request_path,
                guard='non_work_auth_guard',
                action='allow',
                reason='public_work_view',
            )
            return None

        if int(session.get('user_id') or 0) > 0:
            _log_guard_decision(
                app,
                host=host,
                path=request_path,
                guard='non_work_auth_guard',
                action='allow',
                reason='session_user_id_present',
            )
            return None

        _log_guard_decision(
            app,
            host=host,
            path=request_path,
            guard='non_work_auth_guard',
            action='block',
            reason='missing_session_authentication',
        )
        return ('Unauthorized', 401)

    if app.config.get('ENABLE_LOG_MONITOR', True):
        get_log_monitor(app)
        atexit.register(lambda: shutdown_log_monitor(app))

    if frontend_build_dir:
        @app.get('/')
        @app.get('/<path:path>')
        def serve_frontend(path='index.html'):
            request_path = f'/{path}'.rstrip('/')

            if any(request_path == prefix.rstrip('/') or request_path.startswith(prefix) for prefix in SPA_EXCLUDED_PREFIXES):
                return ('Not Found', 404)

            requested_file = frontend_build_dir / path
            if path and requested_file.exists() and requested_file.is_file():
                return send_from_directory(frontend_build_dir, path)

            return send_from_directory(frontend_build_dir, 'index.html')

        @app.errorhandler(404)
        def spa_fallback(_error):
            request_path = request.path.rstrip('/') or '/'
            if any(request_path == prefix.rstrip('/') or request_path.startswith(prefix) for prefix in SPA_EXCLUDED_PREFIXES):
                return ('Not Found', 404)

            return send_from_directory(frontend_build_dir, 'index.html')

    return app
