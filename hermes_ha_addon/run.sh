#!/bin/bash
# HA add-on startup script
# Reads options from /data/options.json (always mounted by HA Supervisor)
# and starts the Flask app

set -e

OPTIONS_FILE="/data/options.json"

if [ -f "$OPTIONS_FILE" ]; then
    HERMES_HOST="$(jq -r '.hermes_host // empty' "$OPTIONS_FILE")"
    HERMES_API_KEY="$(jq -r '.hermes_api_key // empty' "$OPTIONS_FILE")"
    REGISTRY_PORT="$(jq -r '.registry_port // "8641"' "$OPTIONS_FILE")"
    DEFAULT_PROFILE="$(jq -r '.default_profile // "default"' "$OPTIONS_FILE")"
    MANUAL_PROFILES="$(jq -c '.manual_profiles // []' "$OPTIONS_FILE")"
    LOG_LEVEL="$(jq -r '.log_level // "info"' "$OPTIONS_FILE")"
else
    echo "WARNING: $OPTIONS_FILE not found, using env vars or defaults"
    HERMES_HOST="${HERMES_HOST:-}"
    HERMES_API_KEY="${HERMES_API_KEY:-}"
    REGISTRY_PORT="${REGISTRY_PORT:-8641}"
    DEFAULT_PROFILE="${DEFAULT_PROFILE:-default}"
    MANUAL_PROFILES="${MANUAL_PROFILES:-[]}"
    LOG_LEVEL="${LOG_LEVEL:-info}"
fi

export HERMES_HOST
export HERMES_API_KEY
export REGISTRY_PORT
export DEFAULT_PROFILE
export MANUAL_PROFILES
export LOG_LEVEL

echo "Starting Hermes Agent Chat add-on..."
echo "  Hermes host: ${HERMES_HOST:-not configured}"
echo "  Registry port: ${REGISTRY_PORT}"
echo "  Default profile: ${DEFAULT_PROFILE}"
echo "  Log level: ${LOG_LEVEL}"

cd /app
exec python3 app.py