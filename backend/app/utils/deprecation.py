from flask import current_app, request


def log_deprecated_route(old_path: str, new_path: str) -> None:
    current_app.logger.info(
        "deprecated route used old=%s new=%s method=%s remote_addr=%s",
        str(old_path or "").strip(),
        str(new_path or "").strip(),
        str(request.method or "").upper(),
        request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip() or "unknown",
    )
