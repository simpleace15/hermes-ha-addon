#!/usr/bin/env bashio
# HA add-on startup script
# Reads options from HA Supervisor via /data/options.json and starts Flask

set -e

OPTIONS_FILE="/data/options.json"

if bashio::config.exists 'hermes_host'; then
    HERMES_HOST="$(bashio::config 'hermes_host')"
else
    HERMES_HOST=""
fi

if bashio::config.exists 'hermes_api_key'; then
    HERMES_API_KEY="$(bashio::config 'hermes_api_key')"
else
    HERMES_API_KEY=""
fi

if bashio::config.exists 'registry_port'; then
    REGISTRY_PORT="$(bashio::config 'registry_port')"
else
    REGISTRY_PORT="8641"
fi

if bashio::config.exists 'default_profile'; then
    DEFAULT_PROFILE="$(bashio::config 'default_profile')"
else
    DEFAULT_PROFILE="default"
fi

# Manual profiles as JSON string
MANUAL_PROFILES="$(bashio::config 'manual_profiles' 2>/dev/null || echo '[]')"
if [ -z "$MANUAL_PROFILES" ] || [ "$MANUAL_PROFILES" = "null" ]; then
    MANUAL_PROFILES="[]"
fi

export HERMES_HOST
export HERMES_API_KEY
export REGISTRY_PORT
export DEFAULT_PROFILE
export MANUAL_PROFILES

bashio::log.info "Starting Hermes Agent Chat add-on..."
bashio::log.info "  Hermes host: ${HERMES_HOST:-not configured}"
bashio::log.info "  Registry port: ${REGISTRY_PORT}"
bashio::log.info "  Default profile: ${DEFAULT_PROFILE}"

cd /app
exec python3 app.py