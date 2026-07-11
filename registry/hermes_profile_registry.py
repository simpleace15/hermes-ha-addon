#!/usr/bin/env python3
"""
hermes_profile_registry.py — Profile discovery HTTP server for Hermes Agent.

Runs on the Hermes host and responds to GET /profiles with a JSON list of
active Hermes profiles (name, port, model, health status).

Usage:
    python3 hermes_profile_registry.py --port 8641
    python3 hermes_profile_registry.py --port 8641 --api-key "your-secret"
    python3 hermes_profile_registry.py --port 8641 --bind 0.0.0.0

The API key defaults to the API_SERVER_KEY found in the default profile's
.env file (~/.hermes/.env). All profiles should use the same key.

Requires: Python 3.8+, no external dependencies (stdlib only).
"""

import argparse
import http.server
import json
import os
import socket
import sys
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError, HTTPError

# Resolve HERMES_HOME: if HERMES_HOME env var points to a profile-specific dir
# (e.g. ~/.hermes/profiles/coder), walk up to find the real Hermes root.
_env_hermes_home = os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes"))
HERMES_HOME = Path(_env_hermes_home)
# If this looks like a profile dir (parent is "profiles"), go up two levels
if HERMES_HOME.name and HERMES_HOME.parent.name == "profiles":
    HERMES_HOME = HERMES_HOME.parent.parent
DEFAULT_PORT = 8642
HEALTH_TIMEOUT = 3  # seconds


def read_env_file(env_path):
    """Parse a .env file into a dict. Simple KEY=VALUE parser."""
    result = {}
    if not env_path.exists():
        return result
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        result[key] = value
    return result


def discover_profiles():
    """
    Scan ~/.hermes/ for the default profile + ~/.hermes/profiles/ for named profiles.
    For each, read .env to find API_SERVER_ENABLED, API_SERVER_PORT.
    Returns a list of profile dicts.
    """
    profiles = []

    # Default profile (lives directly in ~/.hermes/)
    default_env = HERMES_HOME / ".env"
    default_cfg = read_env_file(default_env)
    # API server is enabled if API_SERVER_ENABLED=true OR API_SERVER_KEY is set
    # (Hermes gates the platform on API_SERVER_KEY presence)
    if default_cfg.get("API_SERVER_ENABLED", "").lower() == "true" or default_cfg.get("API_SERVER_KEY"):
        port = int(default_cfg.get("API_SERVER_PORT", str(DEFAULT_PORT)))
        model = default_cfg.get("MODEL", "hermes-agent")
        # Try to get a nicer model name
        model_name = default_cfg.get("MODEL_PROVIDER", "") + "/" + model if default_cfg.get("MODEL_PROVIDER") else model
        profiles.append({
            "name": "default",
            "port": port,
            "model": model_name,
            "status": "unknown",  # Will be checked
        })

    # Named profiles (in ~/.hermes/profiles/<name>/)
    profiles_dir = HERMES_HOME / "profiles"
    if profiles_dir.exists():
        for entry in sorted(profiles_dir.iterdir()):
            if not entry.is_dir():
                continue
            profile_env = entry / ".env"
            cfg = read_env_file(profile_env)
            # Same gate: API_SERVER_ENABLED=true OR API_SERVER_KEY present
            if cfg.get("API_SERVER_ENABLED", "").lower() != "true" and not cfg.get("API_SERVER_KEY"):
                continue
            port = int(cfg.get("API_SERVER_PORT", str(DEFAULT_PORT)))
            model = cfg.get("MODEL", entry.name)
            model_name = cfg.get("MODEL_PROVIDER", "") + "/" + model if cfg.get("MODEL_PROVIDER") else model
            profiles.append({
                "name": entry.name,
                "port": port,
                "model": model_name,
                "status": "unknown",
            })

    return profiles


def check_health(port, api_key, timeout=HEALTH_TIMEOUT):
    """Quick health check on a Hermes API port."""
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/health",
            headers={"Authorization": f"Bearer {api_key}"} if api_key else {},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return "online" if resp.status == 200 else "offline"
    except (URLError, HTTPError, ConnectionError, socket.timeout, OSError):
        return "offline"


def get_api_key():
    """Read API_SERVER_KEY from the default profile's .env."""
    default_env = HERMES_HOME / ".env"
    cfg = read_env_file(default_env)
    return cfg.get("API_SERVER_KEY", "")


def build_response(api_key):
    """Build the full profiles response with health checks."""
    profiles = discover_profiles()

    # Check health of each profile
    for p in profiles:
        p["status"] = check_health(p["port"], api_key)

    # Determine host IP for the response
    host_ip = get_local_ip()

    return {
        "host": host_ip,
        "profiles": profiles,
    }


def get_local_ip():
    """Get the local IP address (best effort)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# ── HTTP Server ──────────────────────────────────────────────────────

import urllib.request


class RegistryHandler(http.server.BaseHTTPRequestHandler):
    """HTTP handler for the profile registry."""

    api_key = ""

    def do_GET(self):
        if self.path == "/profiles" or self.path == "/":
            self._handle_profiles()
        elif self.path == "/health":
            self._handle_health()
        else:
            self.send_error(404, "Not Found")

    def _handle_health(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"status": "ok"}).encode())

    def _handle_profiles(self):
        # Auth check
        if self.api_key:
            auth = self.headers.get("Authorization", "")
            if not auth.startswith("Bearer "):
                self.send_error(401, "Unauthorized: Bearer token required")
                return
            token = auth[7:]
            if token != self.api_key:
                self.send_error(403, "Forbidden: invalid API key")
                return

        try:
            response = build_response(self.api_key)
            body = json.dumps(response, indent=2).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            error = json.dumps({"error": str(e)}).encode()
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(error)

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        """Suppress default logging unless --verbose."""
        if self.verbose:
            super().log_message(format, *args)


class VerboseRegistryHandler(RegistryHandler):
    verbose = True


def main():
    parser = argparse.ArgumentParser(description="Hermes Profile Registry Server")
    parser.add_argument("--port", type=int, default=8641, help="Port to listen on (default: 8641)")
    parser.add_argument("--bind", default="0.0.0.0", help="Address to bind to (default: 0.0.0.0)")
    parser.add_argument("--api-key", default=None, help="API key for auth (defaults to API_SERVER_KEY from ~/.hermes/.env)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose logging")
    args = parser.parse_args()

    # Resolve API key
    api_key = args.api_key or get_api_key()
    if not api_key:
        print("WARNING: No API key set. Server will run without authentication.", file=sys.stderr)
        print("Set --api-key or configure API_SERVER_KEY in ~/.hermes/.env", file=sys.stderr)

    RegistryHandler.api_key = api_key

    handler_class = VerboseRegistryHandler if args.verbose else RegistryHandler
    if not args.verbose:
        RegistryHandler.verbose = False

    server = http.server.HTTPServer((args.bind, args.port), handler_class)

    print(f"Hermes Profile Registry")
    print(f"  Listening: http://{args.bind}:{args.port}")
    print(f"  Endpoint:  GET /profiles")
    print(f"  Auth:      {'Bearer token' if api_key else 'NONE (insecure!)'}")
    print(f"  Hermes:    {HERMES_HOME}")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()