"""
hermes_proxy.py — Hermes API proxy logic for the HA add-on.

Handles all HTTP communication with remote Hermes API servers:
- Profile discovery via registry endpoint
- Session CRUD proxying
- Chat (SSE streaming proxy)
- Capabilities/models/skills/toolsets proxying
"""

import logging
from urllib.parse import urljoin

import requests

log = logging.getLogger("hermes_proxy")

# Timeout for non-streaming API calls
DEFAULT_TIMEOUT = 30
# Timeout for the initial connection of an SSE stream (read is open-ended)
STREAM_CONNECT_TIMEOUT = 10


class HermesProxy:
    """Stateful proxy that routes requests to the active Hermes profile."""

    def __init__(self, hermes_host, api_key, registry_port="8641",
                 default_profile="default", manual_profiles=None):
        # Normalise host: strip trailing slash
        self.hermes_host = hermes_host.rstrip("/")
        self.api_key = api_key
        self.registry_port = str(registry_port)
        self.default_profile = default_profile
        self.manual_profiles = manual_profiles or []
        self._profiles_cache = None

    # ── Auth headers ──────────────────────────────────────────────────

    @property
    def auth_headers(self):
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    # ── Profile URL ───────────────────────────────────────────────────

    def profile_url(self, port, path=""):
        """Build a URL for a Hermes profile API server."""
        base = f"{self.hermes_host}:{port}"
        if path:
            base = f"{base}/{path.lstrip('/')}"
        return base

    def registry_url(self, path=""):
        """Build a URL for the profile registry endpoint."""
        base = f"{self.hermes_host}:{self.registry_port}"
        if path:
            base = f"{base}/{path.lstrip('/')}"
        return base

    # ── Profile Discovery ─────────────────────────────────────────────

    def discover_profiles(self):
        """
        Discover profiles via the registry endpoint.
        Falls back to manual_profiles if registry is unavailable.
        Returns a list of profile dicts: {name, port, model, status}
        """
        log.info("discover_profiles: host=%s registry_port=%s", self.hermes_host, self.registry_port)
        if self.manual_profiles:
            log.info("discover_profiles: using manual profiles config (%d entries)", len(self.manual_profiles))
            return self._check_manual_profiles()

        registry_url = self.registry_url("profiles")
        log.debug("discover_profiles: fetching %s", registry_url)
        try:
            resp = requests.get(
                registry_url,
                headers=self.auth_headers,
                timeout=DEFAULT_TIMEOUT,
            )
            log.debug("discover_profiles: registry returned status=%d", resp.status_code)
            resp.raise_for_status()
            data = resp.json()

            # Registry returns {"host": "...", "profiles": [...]}
            if isinstance(data, dict) and "profiles" in data:
                profiles = data["profiles"]
            elif isinstance(data, list):
                profiles = data
            else:
                log.warning("Unexpected registry response shape: %s", type(data))
                profiles = []

            self._profiles_cache = profiles
            log.info("Discovered %d profiles via registry", len(profiles))
            return profiles

        except requests.RequestException as e:
            log.warning("discover_profiles: registry unavailable: %s — falling back", e)
            if self.manual_profiles:
                return self._check_manual_profiles()
            # Last resort: assume just the default profile on the default port
            log.warning("discover_profiles: no registry, no manual profiles — assuming default on port 8642")
            return [{
                "name": self.default_profile,
                "port": 8642,
                "model": self.default_profile,
                "status": "unknown",
            }]

    def _check_manual_profiles(self):
        """Check health of manually configured profiles."""
        results = []
        for p in self.manual_profiles:
            name = p.get("name", "unknown")
            port = str(p.get("port", "8642"))
            status = self._health_check(port)
            results.append({
                "name": name,
                "port": int(port),
                "model": name,
                "status": status,
            })
        return results

    def _health_check(self, port):
        """Quick health check on a Hermes API port."""
        try:
            resp = requests.get(
                self.profile_url(port, "health"),
                headers=self.auth_headers,
                timeout=5,
            )
            return "online" if resp.ok else "offline"
        except requests.RequestException:
            return "offline"

    # ── Generic proxy helpers ─────────────────────────────────────────

    def _proxy_get(self, port, path, params=None):
        """Proxy a GET request to a Hermes profile."""
        url = self.profile_url(port, path)
        log.debug("GET %s params=%s", url, params)
        resp = requests.get(
            url, headers=self.auth_headers, params=params, timeout=DEFAULT_TIMEOUT
        )
        log.debug("GET %s → status=%d len=%d", url, resp.status_code, len(resp.content))
        return resp

    def _proxy_post(self, port, path, json_data=None):
        """Proxy a POST request to a Hermes profile."""
        url = self.profile_url(port, path)
        log.debug("POST %s json=%s", url, json_data)
        resp = requests.post(
            url, headers=self.auth_headers, json=json_data, timeout=DEFAULT_TIMEOUT
        )
        log.debug("POST %s → status=%d len=%d", url, resp.status_code, len(resp.content))
        return resp

    def _proxy_delete(self, port, path):
        """Proxy a DELETE request to a Hermes profile."""
        url = self.profile_url(port, path)
        log.debug("DELETE %s", url)
        resp = requests.delete(url, headers=self.auth_headers, timeout=DEFAULT_TIMEOUT)
        log.debug("DELETE %s → status=%d", url, resp.status_code)
        return resp

    # ── Sessions ──────────────────────────────────────────────────────

    def list_sessions(self, port, limit=50):
        resp = self._proxy_get(port, "api/sessions", params={"limit": limit})
        return resp

    def create_session(self, port, title=None):
        body = {}
        if title:
            body["title"] = title
        return self._proxy_post(port, "api/sessions", json_data=body)

    def get_session(self, port, session_id):
        return self._proxy_get(port, f"api/sessions/{session_id}")

    def get_session_messages(self, port, session_id):
        return self._proxy_get(port, f"api/sessions/{session_id}/messages")

    def delete_session(self, port, session_id):
        return self._proxy_delete(port, f"api/sessions/{session_id}")

    def fork_session(self, port, session_id):
        return self._proxy_post(port, f"api/sessions/{session_id}/fork")

    # ── Chat (SSE Streaming) ──────────────────────────────────────────

    def chat_stream(self, port, messages, model=None, session_id=None, stream_options=None):
        """
        Send a chat request and return a streaming generator.
        Uses POST /v1/chat/completions with stream=true.

        Yields raw SSE lines (bytes) suitable for Flask Response.
        """
        url = self.profile_url(port, "v1/chat/completions")
        body = {
            "model": model or "hermes-agent",
            "messages": messages,
            "stream": True,
        }
        if session_id:
            body["session_id"] = session_id
        if stream_options:
            body["stream_options"] = stream_options

        log.debug("Starting SSE stream to %s (model=%s, session=%s)", url, body["model"], session_id)

        # Stream=True keeps the connection open for iteration
        resp = requests.post(
            url,
            headers=self.auth_headers,
            json=body,
            stream=True,
            timeout=(STREAM_CONNECT_TIMEOUT, None),  # connect timeout, no read timeout
        )

        # If non-2xx, consume the error body and raise
        if not resp.ok:
            error_body = resp.text
            resp.close()
            raise HermesAPIError(resp.status_code, error_body)

        return resp

    # ── Chat (Non-Streaming — for workspace queries) ────────────────────

    def chat_sync(self, port, messages, model=None, session_id=None):
        """
        Send a chat request and return the full response (no streaming).
        Used for workspace file listing/reading where we need the complete
        response before processing.
        """
        url = self.profile_url(port, "v1/chat/completions")
        body = {
            "model": model or "hermes-agent",
            "messages": messages,
            "stream": False,
        }
        if session_id:
            body["session_id"] = session_id

        log.debug("chat_sync to %s (model=%s, msgs=%d)", url, body["model"], len(messages))
        resp = requests.post(
            url,
            headers=self.auth_headers,
            json=body,
            timeout=120,  # 2min timeout for tool execution (was 60, too short for some queries)
        )
        if not resp.ok:
            raise HermesAPIError(resp.status_code, resp.text)
        return resp

    # ── Capabilities / Models / Skills / Toolsets ─────────────────────

    def get_capabilities(self, port):
        return self._proxy_get(port, "v1/capabilities")

    def get_models(self, port):
        return self._proxy_get(port, "v1/models")

    def get_skills(self, port):
        return self._proxy_get(port, "v1/skills")

    def get_toolsets(self, port):
        return self._proxy_get(port, "v1/toolsets")

class HermesAPIError(Exception):
    """Raised when the Hermes API returns a non-2xx status."""

    def __init__(self, status_code, body):
        self.status_code = status_code
        self.body = body
        super().__init__(f"Hermes API error {status_code}: {body[:200]}")