import hashlib
import re
import subprocess
import threading
from datetime import datetime, timezone
from time import time

from requests import RequestException

from .ai_client import build_compat_chat_response, call_gateway_chat


_CONTAINER_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$")
_RELEVANT_PATTERN = re.compile(r"(error|warn|exception|traceback)", re.IGNORECASE)
_WARNING_PATTERN = re.compile(r"\bwarn(?:ing)?\b", re.IGNORECASE)
_ERROR_PATTERN = re.compile(r"(error|exception|traceback)", re.IGNORECASE)
_SEVERITY_PATTERN = re.compile(r"\b(low|medium|high)\b", re.IGNORECASE)
_MISSING_CONTEXT_PATTERN = re.compile(
    r"(error log.*missing|no data provided|no log provided|log missing|provide (the )?specific error message|share (the )?details)",
    re.IGNORECASE,
)
_CADDY_DISCONNECT_NOISE_PATTERN = re.compile(
    r"(aborting with incomplete response|broken pipe|connection reset by peer|stream closed)",
    re.IGNORECASE,
)
_AUTH_PROBE_NOISE_PATTERN = re.compile(
    r"(unauthorized|missing session authentication|invalid credentials|/api/auth/)",
    re.IGNORECASE,
)
_MAX_BLOCK_LINES = 40
_MAX_SUMMARY_ITEMS = 64
_DEFAULT_STALE_SECONDS = 30
_DEFAULT_SCAN_SECONDS = 20


def _utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def _clean_line(line):
    return re.sub(r"\s+", " ", str(line or "").strip())


def _looks_like_missing_context_message(summary):
    return bool(_MISSING_CONTEXT_PATTERN.search(str(summary or "")))


def _is_noise_block(text):
    value = str(text or "")
    if not value.strip():
        return True

    if _CADDY_DISCONNECT_NOISE_PATTERN.search(value):
        return True

    # Skip repetitive unauthorized probe noise from scanners to keep summary actionable.
    if _AUTH_PROBE_NOISE_PATTERN.search(value):
        return True

    return False


class LogMonitorService:
    def __init__(self, app=None, stale_seconds=_DEFAULT_STALE_SECONDS, scan_interval_seconds=_DEFAULT_SCAN_SECONDS):
        self._app = app
        self._stale_seconds = max(5, int(stale_seconds))
        self._scan_interval_seconds = max(10, int(scan_interval_seconds))
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread = None

        self._last_checked_timestamp = 0.0
        self._last_checked_by_container = {}
        self._analyzed_hashes = set()
        self._summary_cache = {}

    def start_background(self):
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop_event.clear()
            self._thread = threading.Thread(target=self._worker_loop, name="log-monitor", daemon=True)
            self._thread.start()

    def stop_background(self):
        self._stop_event.set()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=1.5)

    def get_summary(self):
        should_refresh = False
        with self._lock:
            now_ts = time()
            should_refresh = (now_ts - self._last_checked_timestamp) > self._stale_seconds

        if should_refresh:
            self.refresh()

        with self._lock:
            errors = list(self._summary_cache.values())
            errors_sorted = sorted(
                [item for item in errors if item.get("type") == "error"],
                key=lambda item: item.get("timestamp", ""),
                reverse=True,
            )
            warnings_sorted = sorted(
                [item for item in errors if item.get("type") == "warning"],
                key=lambda item: item.get("timestamp", ""),
                reverse=True,
            )

        return {
            "errors": [self._public_item(item) for item in errors_sorted[:20]],
            "warnings": [self._public_item(item) for item in warnings_sorted[:20]],
            "lastChecked": _utc_now_iso(),
        }

    def refresh(self):
        containers, list_error = self._list_running_containers()
        if list_error or not containers:
            with self._lock:
                self._last_checked_timestamp = time()
            return

        for container in containers:
            self._process_container(container)

        with self._lock:
            self._last_checked_timestamp = time()

    def _worker_loop(self):
        while not self._stop_event.is_set():
            try:
                self.refresh()
            except Exception:
                # Keep background worker resilient. Request path will retry.
                pass
            self._stop_event.wait(self._scan_interval_seconds)

    def _list_running_containers(self):
        try:
            result = subprocess.run(
                ["docker", "ps", "--format", "{{.Names}}"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
        except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
            return [], "docker_unavailable"

        if result.returncode != 0:
            return [], "docker_error"

        containers = [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]
        valid = [name for name in containers if _CONTAINER_PATTERN.match(name)]
        return valid, None

    def _process_container(self, container):
        since_ts = self._last_checked_by_container.get(container, max(0, int(time()) - 120))
        lines = self._fetch_new_logs(container, since_ts)
        self._last_checked_by_container[container] = int(time())
        if not lines:
            return

        blocks = self._extract_relevant_blocks(lines)
        for block in blocks:
            normalized = block.get("text", "").strip()
            if not normalized:
                continue
            if _is_noise_block(normalized):
                continue

            block_hash = hashlib.sha256(normalized.encode("utf-8", errors="ignore")).hexdigest()
            with self._lock:
                if block_hash in self._analyzed_hashes:
                    continue
                self._analyzed_hashes.add(block_hash)

            summary = self._summarize_with_ai(normalized)
            if _looks_like_missing_context_message(summary):
                # Ignore non-actionable AI phrasing when no concrete log data is present.
                continue
            severity = self._infer_severity(summary)
            item_type = "warning" if block.get("kind") == "warning" else "error"
            cache_item = {
                "hash": block_hash,
                "message": summary,
                "severity": severity,
                "timestamp": _utc_now_iso(),
                "type": item_type,
                "container": container,
            }

            with self._lock:
                self._summary_cache[block_hash] = cache_item
                if len(self._summary_cache) > _MAX_SUMMARY_ITEMS:
                    oldest = sorted(
                        self._summary_cache.items(),
                        key=lambda pair: pair[1].get("timestamp", ""),
                    )
                    for stale_hash, _ in oldest[: len(self._summary_cache) - _MAX_SUMMARY_ITEMS]:
                        self._summary_cache.pop(stale_hash, None)

    def _fetch_new_logs(self, container, since_ts):
        try:
            result = subprocess.run(
                ["docker", "logs", "--since", str(int(since_ts)), "--tail", "600", container],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
        except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
            return []

        if result.returncode != 0:
            return []

        text = "\n".join([part for part in [result.stdout, result.stderr] if part]).strip()
        if not text:
            return []
        return [line for line in text.splitlines() if line.strip()]

    def _extract_relevant_blocks(self, lines):
        blocks = []
        current = []
        current_kind = "error"
        for raw_line in lines:
            line = _clean_line(raw_line)
            if not line:
                if current:
                    blocks.append({"kind": current_kind, "text": "\n".join(current)})
                    current = []
                    current_kind = "error"
                continue

            if _RELEVANT_PATTERN.search(line):
                if _WARNING_PATTERN.search(line) and not _ERROR_PATTERN.search(line):
                    line_kind = "warning"
                else:
                    line_kind = "error"

                if current and len(current) < _MAX_BLOCK_LINES:
                    current.append(line)
                else:
                    if current:
                        blocks.append({"kind": current_kind, "text": "\n".join(current)})
                    current = [line]
                    current_kind = line_kind
                continue

            if current and len(current) < _MAX_BLOCK_LINES and (line.startswith("at ") or line.startswith("File ")):
                current.append(line)
                continue

            if current:
                blocks.append({"kind": current_kind, "text": "\n".join(current)})
                current = []
                current_kind = "error"

        if current:
            blocks.append({"kind": current_kind, "text": "\n".join(current)})
        return blocks

    def _summarize_with_ai(self, text):
        app = self._app
        if not str(text or "").strip():
            return "No logs available to analyze"
        prompt = (
            "Summarize this system error in one sentence and include severity (low/medium/high):\n\n"
            f"{text[:4000]}"
        )
        payload = {
            "analysis_mode": "focused",
            "messages": [{"role": "user", "content": prompt}],
        }

        try:
            result = call_gateway_chat(payload, app.config["AI_GATEWAY_BASE_URL"])
            compat = build_compat_chat_response(payload, result)
            message = _clean_line(compat.get("message", ""))
            return message or "Issue detected in container logs."
        except (RequestException, KeyError):
            # Safe fallback if AI gateway is unavailable.
            first_line = _clean_line(text.splitlines()[0] if text else "")
            return first_line[:220] or "Issue detected in container logs."

    def _infer_severity(self, summary_text):
        match = _SEVERITY_PATTERN.search(str(summary_text or ""))
        if match:
            return match.group(1).lower()
        lowered = str(summary_text or "").lower()
        if "timeout" in lowered or "failing" in lowered or "failed" in lowered:
            return "high"
        if "warn" in lowered:
            return "medium"
        return "medium"

    def _public_item(self, item):
        return {
            "hash": item.get("hash"),
            "message": item.get("message"),
            "severity": item.get("severity", "medium"),
            "timestamp": item.get("timestamp"),
        }


def get_log_monitor(app):
    monitor = app.extensions.get("log_monitor")
    if monitor:
        return monitor

    monitor = LogMonitorService(app=app)
    app.extensions["log_monitor"] = monitor
    monitor.start_background()
    return monitor


def shutdown_log_monitor(app):
    monitor = app.extensions.get("log_monitor")
    if monitor:
        monitor.stop_background()
