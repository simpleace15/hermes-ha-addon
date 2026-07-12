"""
app.py — Flask entry point for the Hermes HA add-on.

Serves the vanilla JS frontend and proxies all API calls to the remote
Hermes API server. Designed for HA Ingress (path prefix aware).
"""

import json
import logging
import os
import traceback

from flask import (
    Flask, request, jsonify, Response, send_from_directory,
    stream_with_context
)

import requests
from hermes_proxy import HermesProxy, HermesAPIError, DEFAULT_TIMEOUT
from profile_registry import ProfileRegistry

# ── Config from HA add-on options ─────────────────────────────────────
HERMES_HOST = os.environ.get("HERMES_HOST", "")
HERMES_API_KEY = os.environ.get("HERMES_API_KEY", "")
REGISTRY_PORT = os.environ.get("REGISTRY_PORT", "8641")
DEFAULT_PROFILE = os.environ.get("DEFAULT_PROFILE", "default")
LOG_LEVEL = os.environ.get("LOG_LEVEL", "info").upper()
THEME = os.environ.get("THEME", "ha-dark")

# Manual profiles come as JSON string from HA options
_manual_raw = os.environ.get("MANUAL_PROFILES", "[]")
try:
    MANUAL_PROFILES = json.loads(_manual_raw) if _manual_raw else []
except (json.JSONDecodeError, TypeError):
    MANUAL_PROFILES = []

# ── Logging ──────────────────────────────────────────────────────────
LEVELS = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
    "CRITICAL": logging.CRITICAL,
}
logging.basicConfig(
    level=LEVELS.get(LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
# Also set werkzeug (Flask request logger) to same level
logging.getLogger("werkzeug").setLevel(LEVELS.get(LOG_LEVEL, logging.INFO))
log = logging.getLogger("hermes_addon")

# ── Flask App ─────────────────────────────────────────────────────────
app = Flask(__name__, static_folder="static", static_url_path="/static")

# Ingress path prefix — HA serves add-ons under /api/hassio_ingress/<token>/
# We handle this by using relative paths in the frontend and
# stripping the prefix for static files via the catch-all route.

# ── Hermes Proxy instance ────────────────────────────────────────────
proxy = HermesProxy(
    hermes_host=HERMES_HOST,
    api_key=HERMES_API_KEY,
    registry_port=REGISTRY_PORT,
    default_profile=DEFAULT_PROFILE,
    manual_profiles=MANUAL_PROFILES,
)

# Thread-safe profile cache
registry = ProfileRegistry(proxy)


# ── Helper: resolve profile port ─────────────────────────────────────

def resolve_port(profile_name):
    """Look up a profile's port from the registry cache."""
    log.debug("resolve_port: looking up profile=%s", profile_name)
    port = registry.get_port(profile_name)
    if port:
        log.debug("resolve_port: found port=%s for profile=%s", port, profile_name)
        return port
    log.warning("resolve_port: profile=%s not found in registry, falling back to port 8642", profile_name)
    return 8642


def get_profile_from_request():
    """Extract the requested profile name from headers or query params."""
    profile = request.headers.get("X-Hermes-Profile")
    if not profile:
        profile = request.args.get("profile", DEFAULT_PROFILE)
    return profile


# ── Routes: Frontend ──────────────────────────────────────────────────

@app.route("/")
def index():
    """Serve the main page. Works under Ingress prefix."""
    return send_from_directory(app.static_folder, "index.html")


@app.route("/health")
def health():
    """HA health check endpoint."""
    return jsonify({"status": "ok"})


# ── Routes: Profile Discovery ─────────────────────────────────────────

@app.route("/api/profiles")
def api_profiles():
    """Return discovered profiles from the registry."""
    log.info("GET /api/profiles — requesting profile discovery")
    log.debug("  HERMES_HOST=%s  REGISTRY_PORT=%s", HERMES_HOST, REGISTRY_PORT)
    try:
        profiles = registry.get_profiles(force_refresh=True)
        log.info("GET /api/profiles — returned %d profiles", len(profiles))
        for p in profiles:
            log.debug("  profile: %s (port=%s, status=%s)", p.get("name"), p.get("port"), p.get("status"))
        return jsonify({"profiles": profiles, "default": DEFAULT_PROFILE})
    except Exception as e:
        log.error("GET /api/profiles — discovery failed: %s", e)
        log.debug("  traceback: %s", traceback.format_exc())
        return jsonify({"profiles": [], "error": str(e)}), 502


# ── Routes: Sessions ──────────────────────────────────────────────────

@app.route("/api/sessions")
def list_sessions():
    profile = get_profile_from_request()
    port = resolve_port(profile)
    limit = request.args.get("limit", 50, type=int)
    log.info("GET /api/sessions — profile=%s port=%s limit=%s", profile, port, limit)
    try:
        resp = proxy.list_sessions(port, limit=limit)
        log.info("GET /api/sessions — Hermes returned status=%d", resp.status_code)
        log.debug("  response body: %s", resp.text[:500])
        return Response(resp.content, status=resp.status_code,
                        content_type=resp.headers.get("Content-Type", "application/json"))
    except Exception as e:
        log.error("GET /api/sessions — failed: %s", e)
        log.debug("  traceback: %s", traceback.format_exc())
        return jsonify({"error": str(e)}), 502


@app.route("/api/sessions", methods=["POST"])
def create_session():
    profile = get_profile_from_request()
    port = resolve_port(profile)
    data = request.get_json(silent=True) or {}
    log.info("POST /api/sessions — profile=%s port=%s title=%s", profile, port, data.get("title"))
    try:
        resp = proxy.create_session(port, title=data.get("title"))
        log.info("POST /api/sessions — Hermes returned status=%d", resp.status_code)
        log.debug("  response body: %s", resp.text[:500])
        return Response(resp.content, status=resp.status_code,
                        content_type=resp.headers.get("Content-Type", "application/json"))
    except Exception as e:
        log.error("POST /api/sessions — failed: %s", e)
        log.debug("  traceback: %s", traceback.format_exc())
        return jsonify({"error": str(e)}), 502


@app.route("/api/sessions/<session_id>")
def get_session(session_id):
    profile = get_profile_from_request()
    port = resolve_port(profile)
    try:
        resp = proxy.get_session(port, session_id)
        return Response(resp.content, status=resp.status_code,
                        content_type=resp.headers.get("Content-Type", "application/json"))
    except Exception as e:
        log.error("Get session failed: %s", e)
        return jsonify({"error": str(e)}), 502


@app.route("/api/sessions/<session_id>/messages")
def get_session_messages(session_id):
    profile = get_profile_from_request()
    port = resolve_port(profile)
    try:
        resp = proxy.get_session_messages(port, session_id)
        return Response(resp.content, status=resp.status_code,
                        content_type=resp.headers.get("Content-Type", "application/json"))
    except Exception as e:
        log.error("Get session messages failed: %s", e)
        return jsonify({"error": str(e)}), 502


@app.route("/api/sessions/<session_id>", methods=["DELETE"])
def delete_session(session_id):
    profile = get_profile_from_request()
    port = resolve_port(profile)
    try:
        resp = proxy.delete_session(port, session_id)
        return Response(resp.content, status=resp.status_code,
                        content_type=resp.headers.get("Content-Type", "application/json"))
    except Exception as e:
        log.error("Delete session failed: %s", e)
        return jsonify({"error": str(e)}), 502


@app.route("/api/sessions/<session_id>/fork", methods=["POST"])
def fork_session(session_id):
    profile = get_profile_from_request()
    port = resolve_port(profile)
    try:
        resp = proxy.fork_session(port, session_id)
        return Response(resp.content, status=resp.status_code,
                        content_type=resp.headers.get("Content-Type", "application/json"))
    except Exception as e:
        log.error("Fork session failed: %s", e)
        return jsonify({"error": str(e)}), 502


# ── Routes: Chat (SSE Streaming) ──────────────────────────────────────

@app.route("/api/chat", methods=["POST"])
def chat():
    """
    Proxy chat completions with SSE streaming.
    The browser receives SSE lines as they arrive from Hermes.
    """
    data = request.get_json(silent=True) or {}
    messages = data.get("messages", [])
    model = data.get("model")
    session_id = data.get("session_id")
    profile = data.get("profile", DEFAULT_PROFILE)

    port = resolve_port(profile)
    log.info("Chat request: profile=%s port=%s model=%s msgs=%d", profile, port, model, len(messages))

    try:
        resp = proxy.chat_stream(port, messages, model=model, session_id=session_id)
    except HermesAPIError as e:
        log.error("Chat stream error: %s", e)
        return jsonify({"error": e.body}), e.status_code
    except Exception as e:
        log.error("Chat stream connection failed: %s", e)
        return jsonify({"error": str(e)}), 502

    def generate():
        try:
            for line in resp.iter_lines():
                if line:
                    yield line + b"\n"
                else:
                    yield b"\n"
        except Exception as e:
            log.error("SSE stream interrupted: %s", e)
            yield f'data: {json.dumps({"error": str(e)})}\n\n'.encode()
        finally:
            resp.close()

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
            "Connection": "keep-alive",
        },
    )


@app.route("/api/sessions/<session_id>/chat/stream", methods=["POST"])
def session_chat_stream(session_id):
    """Proxy per-session streaming chat (POST /api/sessions/{id}/chat/stream)."""
    data = request.get_json(silent=True) or {}
    message = data.get("message", "")
    profile = data.get("profile", DEFAULT_PROFILE)
    port = resolve_port(profile)
    log.info("Session chat stream: profile=%s port=%s session=%s", profile, port, session_id)
    try:
        resp = proxy.session_chat_stream(port, session_id, message)
    except HermesAPIError as e:
        return jsonify({"error": e.body}), e.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 502

    def generate():
        try:
            for line in resp.iter_lines():
                if line:
                    yield line + b"\n"
                else:
                    yield b"\n"
        except Exception as e:
            log.error("Session SSE stream interrupted: %s", e)
            yield f'data: {json.dumps({"error": str(e)})}\n\n'.encode()
        finally:
            resp.close()

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@app.route("/api/sessions/<session_id>", methods=["PATCH"])
def update_session(session_id):
    """Rename/update a session."""
    profile = get_profile_from_request()
    port = resolve_port(profile)
    data = request.get_json(silent=True) or {}
    log.info("PATCH /api/sessions/%s — title=%s", session_id, data.get("title"))
    try:
        url = proxy.profile_url(port, f"api/sessions/{session_id}")
        resp = requests.patch(url, headers=proxy.auth_headers, json=data, timeout=DEFAULT_TIMEOUT)
        return Response(resp.content, status=resp.status_code,
                        content_type=resp.headers.get("Content-Type", "application/json"))
    except Exception as e:
        log.error("Update session failed: %s", e)
        return jsonify({"error": str(e)}), 502


# ── Routes: Approval ──────────────────────────────────────────────────

@app.route("/api/approval", methods=["POST"])
def approval():
    """Proxy tool approval/denial to the Hermes API."""
    data = request.get_json(silent=True) or {}
    approval_id = data.get("approval_id", "")
    approved = data.get("approved", False)
    profile = data.get("profile", DEFAULT_PROFILE)
    session_id = data.get("session_id")
    port = resolve_port(profile)
    log.info("Approval: profile=%s port=%s id=%s approved=%s", profile, port, approval_id, approved)

    if not approval_id:
        return jsonify({"error": "approval_id is required"}), 400

    try:
        # Use the run approval endpoint if we have a run_id, otherwise
        # try the session approval endpoint
        url = proxy.profile_url(port, f"v1/runs/{approval_id}/approval")
        resp = requests.post(
            url,
            headers=proxy.auth_headers,
            json={"approved": approved},
            timeout=DEFAULT_TIMEOUT,
        )
        return Response(resp.content, status=resp.status_code,
                        content_type=resp.headers.get("Content-Type", "application/json"))
    except Exception as e:
        log.error("Approval failed: %s", e)
        return jsonify({"error": str(e)}), 502


# ── Routes: Capabilities / Models / Skills / Toolsets ────────────────

@app.route("/api/capabilities")
def capabilities():
    profile = get_profile_from_request()
    port = resolve_port(profile)
    try:
        resp = proxy.get_capabilities(port)
        return Response(resp.content, status=resp.status_code,
                        content_type=resp.headers.get("Content-Type", "application/json"))
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/models")
def models():
    profile = get_profile_from_request()
    port = resolve_port(profile)
    try:
        resp = proxy.get_models(port)
        return Response(resp.content, status=resp.status_code,
                        content_type=resp.headers.get("Content-Type", "application/json"))
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/skills")
def skills():
    profile = get_profile_from_request()
    port = resolve_port(profile)
    try:
        resp = proxy.get_skills(port)
        return Response(resp.content, status=resp.status_code,
                        content_type=resp.headers.get("Content-Type", "application/json"))
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/toolsets")
def toolsets():
    profile = get_profile_from_request()
    port = resolve_port(profile)
    try:
        resp = proxy.get_toolsets(port)
        return Response(resp.content, status=resp.status_code,
                        content_type=resp.headers.get("Content-Type", "application/json"))
    except Exception as e:
        return jsonify({"error": str(e)}), 502


# ── Routes: Workspace ──────────────────────────────────────────────────

@app.route("/api/workspace/list", methods=["POST"])
def workspace_list():
    """
    Ask the agent to list files in a directory.
    Uses a non-streaming chat call — the agent executes file tools
    server-side and returns the listing in the response.
    """
    data = request.get_json(silent=True) or {}
    path = data.get("path", ".")
    profile = data.get("profile", DEFAULT_PROFILE)
    port = resolve_port(profile)
    log.info("workspace_list: profile=%s port=%s path=%s", profile, port, path)

    prompt = (
        f"List the files and directories at '{path}'. "
        "Use the search_files tool with target='files' to find files. "
        "Return ONLY the file listing as a simple list, one entry per line. "
        "Prefix directories with [DIR] and files with [FILE]. "
        "Do not include any other commentary."
    )

    try:
        resp = proxy.chat_sync(
            port,
            messages=[{"role": "user", "content": prompt}],
            model=profile,
        )
        result = resp.json()
        # Extract the assistant's text from the chat completion response
        content = ""
        if "choices" in result and result["choices"]:
            msg = result["choices"][0].get("message", {})
            content = msg.get("content", "")
        return jsonify({"files": content, "path": path})
    except HermesAPIError as e:
        log.error("workspace_list error: %s", e)
        return jsonify({"error": e.body}), e.status_code
    except Exception as e:
        log.error("workspace_list failed: %s", e)
        log.debug("  traceback: %s", traceback.format_exc())
        return jsonify({"error": str(e)}), 502


@app.route("/api/workspace/read", methods=["POST"])
def workspace_read():
    """
    Ask the agent to read a file and return its contents.
    Uses a non-streaming chat call with the read_file tool.
    """
    data = request.get_json(silent=True) or {}
    path = data.get("path", "")
    profile = data.get("profile", DEFAULT_PROFILE)
    port = resolve_port(profile)
    log.info("workspace_read: profile=%s port=%s path=%s", profile, port, path)

    if not path:
        return jsonify({"error": "path is required"}), 400

    prompt = (
        f"Read the file at '{path}' using the read_file tool. "
        "Return the complete file contents with line numbers. "
        "Do not include any commentary, just the file contents."
    )

    try:
        resp = proxy.chat_sync(
            port,
            messages=[{"role": "user", "content": prompt}],
            model=profile,
        )
        result = resp.json()
        content = ""
        if "choices" in result and result["choices"]:
            msg = result["choices"][0].get("message", {})
            content = msg.get("content", "")
        return jsonify({"content": content, "path": path})
    except HermesAPIError as e:
        log.error("workspace_read error: %s", e)
        return jsonify({"error": e.body}), e.status_code
    except Exception as e:
        log.error("workspace_read failed: %s", e)
        log.debug("  traceback: %s", traceback.format_exc())
        return jsonify({"error": str(e)}), 502


# ── Routes: Theme Config ──────────────────────────────────────────────

@app.route("/api/theme")
def get_theme():
    """Return the configured theme from HA options."""
    return jsonify({"theme": THEME})


# ── Catch-all for static files (Ingress-compatible) ───────────────────

@app.route("/<path:filename>")
def static_files(filename):
    """Serve static files, handling Ingress path prefix."""
    # Reject anything that looks like an API route (shouldn't reach here)
    if filename.startswith("api/"):
        return jsonify({"error": "not found"}), 404
    try:
        return send_from_directory(app.static_folder, filename)
    except FileNotFoundError:
        return jsonify({"error": "not found"}), 404


# ── Main ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # In HA add-on, the ingress_port is set via config.yaml
    # Flask listens on all interfaces inside the container
    port = int(os.environ.get("PORT", 8788))
    log.info("Starting Hermes HA Addon on 0.0.0.0:%d", port)
    log.info("Hermes host: %s", HERMES_HOST or "(not configured)")
    log.info("Registry port: %s", REGISTRY_PORT)
    log.info("Default profile: %s", DEFAULT_PROFILE)
    if MANUAL_PROFILES:
        log.info("Manual profiles: %s", [p.get("name") for p in MANUAL_PROFILES])

    # threaded=True is essential for SSE streaming
    app.run(host="0.0.0.0", port=port, threaded=True, debug=False)