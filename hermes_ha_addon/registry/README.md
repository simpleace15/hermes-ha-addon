# Hermes Profile Registry — Setup Guide

The profile registry is a lightweight HTTP server that runs on your Hermes host and tells the HA add-on which Hermes profiles are running and on which ports.

## Quick Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/simpleace15/hermes-ha-addon/main/hermes_ha_addon/registry/install.sh | bash
```

This downloads the script, creates a systemd user service, and starts it on port 8641.

## Manual Install

```bash
# Copy the script to your Hermes host
cp hermes_profile_registry.py ~/hermes_profile_registry.py

# Run it (reads API_SERVER_KEY from ~/.hermes/.env automatically)
python3 ~/hermes_profile_registry.py --port 8641

# Or specify the API key manually
python3 ~/hermes_profile_registry.py --port 8641 --api-key "your-secret-key"
```

## systemd Service

```bash
cat > ~/.config/systemd/user/hermes-registry.service << 'EOF'
[Unit]
Description=Hermes Profile Registry
After=network.target

[Service]
ExecStart=/usr/bin/python3 %h/hermes_profile_registry.py --port 8641
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now hermes-registry
```

## How It Works

1. Scans `~/.hermes/` for the default profile + `~/.hermes/profiles/` for named profiles
2. For each profile, reads `<profile_dir>/.env` to find `API_SERVER_ENABLED` and `API_SERVER_PORT`
3. For each enabled profile, does a quick `GET /health` on its port to check if it's running
4. Returns a JSON array of online profiles

## API

### `GET /profiles`

**Headers:**
```
Authorization: Bearer <API_SERVER_KEY>
```

**Response:**
```json
{
  "host": "192.168.1.100",
  "profiles": [
    {
      "name": "default",
      "port": 8642,
      "model": "hermes-agent",
      "status": "online"
    },
    {
      "name": "coder",
      "port": 8643,
      "model": "coder",
      "status": "online"
    },
    {
      "name": "ha",
      "port": 8644,
      "model": "ha",
      "status": "offline"
    }
  ]
}
```

### `GET /health`

Returns `{"status": "ok"}` — used for health checks.

## CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--port` | `8641` | Port to listen on |
| `--bind` | `0.0.0.0` | Address to bind to |
| `--api-key` | (from .env) | API key for Bearer auth |
| `--verbose` | off | Enable request logging |

## Security

- The registry uses the same `API_SERVER_KEY` as your Hermes API servers
- Bearer token authentication on all endpoints
- Binds to `0.0.0.0` by default so the HA add-on can reach it
- Use `--bind 127.0.0.1` if HA and Hermes are on the same host

## Troubleshooting

### No profiles found

Ensure each profile's `.env` has:
```
API_SERVER_ENABLED=true
API_SERVER_PORT=<unique port>
```

### All profiles show "offline"

- Check that Hermes profiles are running: `hermes status`
- Verify the API server is responding: `curl http://localhost:<port>/health`

### 403 Forbidden

The API key in the registry doesn't match. Either:
- Let it auto-read from `~/.hermes/.env` (default)
- Or pass `--api-key` with the same key as your Hermes profiles

### systemd service won't start

```bash
# Check logs
journalctl --user -u hermes-registry -f

# Common: need to enable lingering for user services to persist
loginctl enable-linger $USER
```