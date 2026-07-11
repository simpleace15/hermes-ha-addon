# hermes-ha-addon

A [Home Assistant](https://www.home-assistant.io/) add-on that provides a web-based chat interface for a **remote** [Hermes Agent](https://hermes-agent.nousresearch.com/) instance.

This add-on does **not** run Hermes Agent itself. It is a thin client that connects to one or more Hermes API servers running on a separate host, auto-discovers available profiles, and lets you chat with any of them from inside Home Assistant via Ingress.

---

## Features

- **Profile Switching** — Auto-discovers profiles from the Hermes host and lets you switch between them from a dropdown
- **Streaming Chat** — SSE streaming with real-time token rendering and tool progress indicators
- **Session Management** — List, create, resume, fork, and delete sessions per profile
- **Slash Commands** — `/new`, `/skills`, `/cron`, `/help` with autocomplete
- **Workspace Browser** — Optional file browser for profiles with file tools enabled
- **Three-Panel Layout** — Collapsible session sidebar, chat center, workspace panel
- **Mobile Responsive** — Works via the HA companion app
- **Dark Theme** — Matches HA's default dark theme

---

## Prerequisites

1. **Home Assistant** (any installation type — OS, Supervised, or Core with add-on support)
2. **Hermes Agent** installed and running on a host reachable from your HA instance
3. **Hermes API Server** enabled for each profile you want to access

### Enabling the Hermes API Server

For each Hermes profile you want to chat with, edit the profile's `.env` file:

```bash
# Default profile: ~/.hermes/.env
# Named profiles: ~/.hermes/profiles/<name>/.env
API_SERVER_ENABLED=true
API_SERVER_KEY=your-secret-api-key
API_SERVER_PORT=8642   # different port per profile
```

Restart the profile after changing settings:

```bash
hermes restart          # default profile
hermes restart coder    # named profile
```

---

## Hermes Host Setup — Profile Registry

The add-on auto-discovers which profiles have their API server running via a lightweight registry endpoint. You need to install this on your Hermes host.

### Option A: One-Command Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/simpleace15/hermes-ha-addon/main/registry/install.sh | bash
```

This downloads the registry script, creates a systemd user service, and starts it. It uses the `API_SERVER_KEY` from your default profile's `.env`.

### Option B: Manual Install

```bash
# Copy the script to your Hermes host
cp registry/hermes_profile_registry.py ~/hermes_profile_registry.py

# Run it (reads the API key from your default profile's .env automatically)
python3 ~/hermes_profile_registry.py --port 8641

# Or specify the API key manually
python3 ~/hermes_profile_registry.py --port 8641 --api-key "your-secret-key"
```

### Option C: Manual systemd Service

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

### Fallback: Manual Profile Config (No Registry)

If you don't want to run the registry script, you can manually specify profiles in the add-on configuration. Under **manual_profiles**, add entries with a name and port for each profile. The add-on will use these instead of auto-discovery.

---

## HA Add-on Installation

### 1. Add the Repository

```yaml
# In HA: Settings → Add-ons → Add-on Store → ⋮ → Repositories
# Add: https://github.com/simpleace15/hermes-ha-addon
```

### 2. Install

After adding the repository, find **Hermes Agent Chat** in the add-on store and click **Install**.

### 3. Configure

Go to the add-on's **Configuration** tab and set:

| Field | Required | Description |
|-------|----------|-------------|
| `hermes_host` | yes | URL of your Hermes host (e.g., `http://192.168.1.100`) |
| `hermes_api_key` | yes | The `API_SERVER_KEY` from your Hermes profiles |
| `registry_port` | no | Port for the profile registry (default: `8641`) |
| `default_profile` | no | Profile to auto-select on first load (default: `default`) |
| `manual_profiles` | no | Fallback: list of `{name, port}` pairs if no registry |

### 4. Start

Click **Start**. The add-on appears in your HA sidebar as **Hermes Agent**.

---

## Usage

### Chat

- Type a message and press Enter (or click send)
- Responses stream in real-time with markdown rendering
- Tool executions show as inline progress cards

### Switch Profiles

- Use the dropdown in the header to switch between profiles
- Each profile has its own session list — switching clears the current chat

### Sessions

- Click **New Session** to start a fresh conversation
- Click any session in the sidebar to resume it
- Use the search bar to filter sessions by title

### Slash Commands

Type `/` to see available commands:

| Command | Description |
|---------|-------------|
| `/new` | Start a new session |
| `/skills` | List installed skills (passed to agent) |
| `/cron` | Show cron jobs (passed to agent) |
| `/profile` | Switch profile (shows selector) |
| `/help` | Show help |

---

## Troubleshooting

### Can't connect to Hermes host

- Verify `hermes_host` is reachable from HA: try `ping` or `curl` from the HA host
- Ensure no firewall is blocking the port(s)
- Check the protocol — use `http://` (not `https://`) for local connections

### Profile not showing in dropdown

- Confirm the profile's API server is running: `curl http://<host>:<port>/health`
- Verify the registry script is running: `curl http://<host>:8641/profiles -H "Authorization: Bearer <key>"`
- If not using the registry, add the profile manually in **manual_profiles**

### Authentication error (401)

- Verify `hermes_api_key` matches the `API_SERVER_KEY` in your Hermes profiles
- All profiles must use the same key (or set per-profile keys in manual_profiles)

### SSE streaming not working / responses appear all at once

- This is usually a proxy buffering issue — the add-on is designed to stream without buffering
- If behind a reverse proxy, ensure it supports SSE (disable response buffering for the add-on path)

### Ingress shows blank page

- Check the add-on logs in HA: Settings → Add-ons → Hermes Agent Chat → Logs
- Ensure the add-on started successfully (port 8788 is internal — Ingress handles routing)

---

## Architecture

```
┌─────────────────────────────────────────┐
│  Home Assistant                         │
│  ┌───────────────────────────────────┐  │
│  │  HA Addon (Docker container)       │  │
│  │  ┌─────────┐    ┌──────────────┐  │  │
│  │  │ Flask   │───▶│ Vanilla JS   │  │  │
│  │  │ Backend │    │ Frontend     │  │  │
│  │  └────┬────┘    └──────────────┘  │  │
│  │       │ HTTP/SSE proxy             │  │
│  └───────┼─────────────────────────────┘  │
└──────────┼───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│  Hermes Agent Host (separate machine)     │
│  ┌─────────────────────────────────────┐ │
│  │ Profile Registry (:8641)             │ │
│  └─────────────────────────────────────┘ │
│  ┌────────┐ ┌────────┐ ┌────────┐       │
│  │default │ │ coder  │ │  ha    │       │
│  │:8642   │ │:8643   │ │:8644   │       │
│  └────────┘ └────────┘ └────────┘       │
└──────────────────────────────────────────┘
```

## License

MIT