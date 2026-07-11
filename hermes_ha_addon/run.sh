#!/bin/bash
# HA add-on startup script
# Reads options from the HA add-on config and starts the Flask app

set -e

# Read config options from the HA add-on environment
# HA Supervisor injects options as environment variables or via /data/options.json
OPTIONS_FILE="/data/options.json"

if [ -f "$OPTIONS_FILE" ]; then
    # Parse HA options JSON
    HERMES_HOST=$(jq -r '.hermes_host // empty' "$OPTIONS_FILE")
    HERMES_API_KEY=$(jq -r '.hermes_api_key // empty' "$OPTIONS_FILE")
    REGISTRY_PORT=$(jq -r '.registry_port // "8641"' "$OPTIONS_FILE")
    DEFAULT_PROFILE=$(jq -r '.default_profile // "default"' "$OPTIONS_FILE")
    MANUAL_PROFILES=$(jq -r '.manual_profiles // [] | @json' "$OPTIONS_FILE")
else
    # Fallback to environment variables (for development/testing)
    HERMES_HOST="${HERMES_HOST:-}"
    HERMES_API_KEY="${HERMES_API_KEY:-}"
    REGISTRY_PORT="${REGISTRY_PORT:-8641}"
    DEFAULT_PROFILE="${DEFAULT_PROFILE:-default}"
    MANUAL_PROFILES="${MANUAL_PROFILES:-[]}"
fi

export HERMES_HOST
export HERMES_API_KEY
export REGISTRY_PORT
export DEFAULT_PROFILE
export MANUAL_PROFILES

echo "Starting Hermes Agent Chat add-on..."
echo "  Hermes host: ${HERMES_HOST:-not configured}"
echo "  Registry port: ${REGISTRY_PORT}"
echo "  Default profile: ${DEFAULT_PROFILE}"

cd /app
exec python app.py