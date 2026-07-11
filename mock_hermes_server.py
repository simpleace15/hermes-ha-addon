"""
mock_hermes_server.py — Mock Hermes API server for testing the HA add-on.

Simulates the Hermes API endpoints needed by the add-on:
- GET /health
- GET /v1/capabilities
- GET /v1/models
- GET /v1/skills
- GET /v1/toolsets
- GET /api/sessions
- POST /api/sessions
- GET /api/sessions/<id>
- GET /api/sessions/<id>/messages
- DELETE /api/sessions/<id>
- POST /api/sessions/<id>/fork
- POST /v1/chat/completions (with SSE streaming)
"""
import json
import time
import uuid
from flask import Flask, request, Response

app = Flask(__name__)

API_KEY = "test-key-12345"

# In-memory storage
SESSIONS = {}
MESSAGES = {}


def check_auth():
    """Simple bearer auth check."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False
    return auth[7:] == API_KEY


@app.before_request
def auth_middleware():
    if request.path == "/health":
        return
    if not check_auth():
        return Response(json.dumps({"error": "unauthorized"}), status=401, mimetype="application/json")


@app.route("/health")
def health():
    return Response(json.dumps({"status": "ok"}), mimetype="application/json")


@app.route("/v1/capabilities")
def capabilities():
    return Response(json.dumps({
        "runs": True,
        "sessions": True,
        "approval": True,
        "tools": ["terminal", "file", "web", "browser"],
        "toolsets": ["terminal", "file", "web", "browser"],
    }), mimetype="application/json")


@app.route("/v1/models")
def models():
    return Response(json.dumps({
        "object": "list",
        "data": [
            {"id": "default", "object": "model", "owned_by": "hermes"},
            {"id": "coder", "object": "model", "owned_by": "hermes"},
        ]
    }), mimetype="application/json")


@app.route("/v1/skills")
def skills():
    return Response(json.dumps([
        {"name": "test-skill", "description": "A test skill"}
    ]), mimetype="application/json")


@app.route("/v1/toolsets")
def toolsets():
    return Response(json.dumps([
        {"name": "terminal", "enabled": True},
        {"name": "file", "enabled": True},
    ]), mimetype="application/json")


# ── Sessions ──────────────────────────────────────────────────────────

@app.route("/api/sessions")
def list_sessions():
    limit = request.args.get("limit", 50, type=int)
    sessions = list(SESSIONS.values())[:limit]
    return Response(json.dumps(sessions), mimetype="application/json")


@app.route("/api/sessions", methods=["POST"])
def create_session():
    session_id = str(uuid.uuid4())
    data = request.get_json(silent=True) or {}
    session = {
        "id": session_id,
        "title": data.get("title") or f"Session {len(SESSIONS) + 1}",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "webui",
    }
    SESSIONS[session_id] = session
    MESSAGES[session_id] = []
    return Response(json.dumps(session), status=201, mimetype="application/json")


@app.route("/api/sessions/<session_id>")
def get_session(session_id):
    if session_id not in SESSIONS:
        return Response(json.dumps({"error": "not found"}), status=404, mimetype="application/json")
    return Response(json.dumps(SESSIONS[session_id]), mimetype="application/json")


@app.route("/api/sessions/<session_id>/messages")
def get_session_messages(session_id):
    if session_id not in MESSAGES:
        return Response(json.dumps({"error": "not found"}), status=404, mimetype="application/json")
    return Response(json.dumps(MESSAGES[session_id]), mimetype="application/json")


@app.route("/api/sessions/<session_id>", methods=["DELETE"])
def delete_session(session_id):
    if session_id in SESSIONS:
        del SESSIONS[session_id]
    if session_id in MESSAGES:
        del MESSAGES[session_id]
    return Response("{}", status=204)


@app.route("/api/sessions/<session_id>/fork", methods=["POST"])
def fork_session(session_id):
    if session_id not in SESSIONS:
        return Response(json.dumps({"error": "not found"}), status=404, mimetype="application/json")
    new_id = str(uuid.uuid4())
    forked = dict(SESSIONS[session_id])
    forked["id"] = new_id
    forked["title"] = forked["title"] + " (fork)"
    SESSIONS[new_id] = forked
    MESSAGES[new_id] = list(MESSAGES.get(session_id, []))
    return Response(json.dumps(forked), status=201, mimetype="application/json")


# ── Chat (SSE Streaming) ────────────────────────────────────────────────

@app.route("/v1/chat/completions", methods=["POST"])
def chat_completions():
    data = request.get_json(silent=True) or {}
    messages = data.get("messages", [])
    model = data.get("model", "default")
    session_id = data.get("session_id")

    user_msg = messages[-1]["content"] if messages else ""

    # Store in session
    if session_id and session_id in MESSAGES:
        MESSAGES[session_id].append({"role": "user", "content": user_msg})

    # Generate a response with tool progress
    response_lines = [
        "I'll help you with that.",
        "",
        "Let me run a command first:",
        "",
        "```bash",
        "echo 'Hello from Hermes'",
        "```",
        "",
        "The result is `Hello from Hermes`.",
        "",
        "## Summary",
        "",
        "This is a **mock response** from the test server. It demonstrates:",
        "",
        "1. SSE **streaming** tokens",
        "2. Tool progress indicators",
        "3. Markdown rendering (headers, bold, code blocks, lists)",
        "",
        "> Note: This is not a real Hermes response.",
    ]

    def generate():
        # Emit a tool progress event first
        tool_event = {
            "event": "hermes.tool.progress",
            "tool": "terminal",
            "detail": f"echo 'Hello from Hermes'",
            "id": "tool-1",
        }
        yield f"data: {json.dumps(tool_event)}\n\n"
        time.sleep(0.3)

        # Emit tool complete
        tool_complete = {
            "event": "hermes.tool.complete",
            "tool": "terminal",
            "id": "tool-1",
        }
        yield f"data: {json.dumps(tool_complete)}\n\n"
        time.sleep(0.1)

        # Stream tokens word by word
        for line in response_lines:
            words = line + "\n" if line else "\n"
            # Stream word by word for realism
            for i in range(0, len(words), 3):
                chunk = words[i:i+3]
                sse_data = {
                    "choices": [{
                        "delta": {"content": chunk},
                        "index": 0,
                    }]
                }
                yield f"data: {json.dumps(sse_data)}\n\n"
                time.sleep(0.02)  # Small delay to see streaming

        # Final [DONE]
        yield "data: [DONE]\n\n"

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )


# ── Profile Registry ───────────────────────────────────────────────────

@app.route("/profiles")
def registry_profiles():
    if not check_auth():
        return Response(json.dumps({"error": "unauthorized"}), status=401, mimetype="application/json")
    return Response(json.dumps({
        "host": "127.0.0.1",
        "profiles": [
            {"name": "default", "port": 8650, "model": "hermes-agent", "status": "online"},
            {"name": "coder", "port": 8651, "model": "coder", "status": "online"},
            {"name": "ha", "port": 8652, "model": "ha", "status": "offline"},
        ]
    }), mimetype="application/json")


if __name__ == "__main__":
    print("Mock Hermes API Server")
    print(f"  API Key: {API_KEY}")
    print(f"  Port: 8650")
    print()
    app.run(host="0.0.0.0", port=8650, threaded=True)