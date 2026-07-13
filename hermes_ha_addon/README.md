<div align="center">

# 🤖 Hermes Agent Chat

### A full-featured Home Assistant add-on for chatting with your remote Hermes Agent

[![Version](https://img.shields.io/badge/version-1.3.0-blue?style=flat-square)](https://github.com/simpleace15/hermes-ha-addon)
[![HA Add-on](https://img.shields.io/badge/Home%20Assistant-Add--on-41bdf5?style=flat-square)](https://www.home-assistant.io/)
[![Stage](https://img.shields.io/badge/stage-experimental-orange?style=flat-square)](https://developers.home-assistant.io/docs/add-ons/)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

[Features](#-features) · [Quick Start](#-quick-start) · [Configuration](#-configuration) · [Architecture](#-architecture) · [Troubleshooting](#-troubleshooting)

</div>

---

> **Hermes Agent** is an autonomous AI agent platform by [Nous Research](https://hermes-agent.nousresearch.com/). This add-on lets you chat with it from inside Home Assistant — with streaming responses, tool execution visibility, session management, and more.

## ✨ Features

### Core Chat
| Feature | Description |
|---------|-------------|
| ⚡ **Real-time streaming** | SSE streaming with live token rendering — responses appear as they're generated |
| 📝 **Full markdown** | Rendered markdown with syntax highlighting for 12+ languages, tables, code blocks with copy buttons |
| 🔧 **Tool execution visibility** | Tool calls show as inline progress cards with status, arguments, and completion state |
| ⚠️ **Tool approval dialogs** | When the agent requests approval for a command, you get an inline approve/deny dialog |
| 📊 **Token usage metadata** | Each response shows model name, prompt/completion token counts, and response time |
| 🖼️ **Image upload** | Paste or drag-drop images into chat — sent in OpenAI vision format for analysis |
| 🔔 **Browser notifications** | Desktop notification + title bar flash when a response finishes and you're on another tab |

### Session Management
| Feature | Description |
|---------|-------------|
| 📋 **Session sidebar** | Browse, search, create, resume, fork, and delete sessions per profile |
| 👁️ **Session preview** | First-message snippet shown for each session (like ChatGPT) |
| 📊 **Session stats** | Message count, tool call count, token usage, estimated cost, and model — all visible as badges |
| ✏️ **Inline rename** | Double-click a session title to rename it |
| 📤 **Export** | Export sessions as Markdown or JSON (with full tool call history and metadata) |
| ⌨️ **Message history** | Press ↑ arrow to recall previous messages, ↓ to go forward |

### Multi-Profile
| Feature | Description |
|---------|-------------|
| 🔄 **Auto-discovery** | Automatically discovers all Hermes profiles via the profile registry — no manual config needed |
| 🎯 **Profile switcher** | Dropdown to switch between profiles (e.g. `coder`, `ha`, `finance`, `default`) |
| 🤖 **Profile labels** | Assistant bubbles show the active profile name instead of generic "assistant" |
| 📡 **Health indicator** | Status bar shows latency (ms), Hermes version, active agent count, and connected platforms |

### Workspace & Tools
| Feature | Description |
|---------|-------------|
| 📁 **File browser** | Browse the agent's workspace — navigate directories, read files (cached for speed) |
| 🎨 **Skills browser** | Browse installed skills with descriptions — click to invoke |
| 🔧 **Toolset manager** | View all toolsets, toggle enable/disable with live switches, see tool tags and config status |

### UI / UX
| Feature | Description |
|---------|-------------|
| 🌙 **4 built-in themes** | HA Dark, HA Light, Midnight Purple, Solarized |
| 🎨 **Auto-theme detection** | Respects your system `prefers-color-scheme` on first visit |
| 📱 **Mobile responsive** | Works in the HA companion app — collapsible sidebar and workspace |
| ⌨️ **Keyboard shortcuts** | `Ctrl+K` focus input, `Ctrl+N` new session, `Ctrl+/` help, `Esc` close panels |
| 🔄 **Auto-reconnect** | Connection drops trigger exponential backoff with countdown timer |
| 🗂️ **Slash commands** | Type `/` for autocomplete — `/new`, `/skills`, `/cron`, `/help`, `/profile`, `/clear` |
| 👁️ **Markdown preview** | Toggle between raw text and rendered preview before sending |

---

## 🚀 Quick Start

### Prerequisites

1. **Home Assistant** with add-on support (OS, Supervised, or Container+addon manager)
2. **Hermes Agent** running on a host reachable from your HA instance
3. **Hermes API Server** enabled on at least one profile

<details>
<summary>📡 Enabling the Hermes API Server</summary>

For each profile you want to chat with, edit its `.env` file:

```bash
# Default profile: ~/.hermes/.env
# Named profiles: ~/.hermes/profiles/<name>/.env
API_SERVER_ENABLED=true
API_SERVER_KEY=your-secret-api-key
API_SERVER_PORT=8642   # different port per profile
```

Restart the profile:

```bash
hermes restart          # default profile
hermes restart coder    # named profile
```

</details>

<details>
<summary>🛰️ Installing the Profile Registry (recommended)</summary>

The add-on auto-discovers profiles via a lightweight registry. Install it on your Hermes host:

**One-command install:**
```bash
curl -fsSL https://raw.githubusercontent.com/simpleace15/hermes-ha-addon/main/hermes_ha_addon/registry/install.sh | bash
```

**Or manually:**
```bash
python3 hermes_profile_registry.py --port 8641
```

The registry reads your `API_SERVER_KEY` from the default profile's `.env` automatically. It runs as a systemd service and auto-starts on boot.

> **Don't want the registry?** You can manually specify profiles in the add-on config under `manual_profiles` — see [Configuration](#-configuration).

</details>

### Install the Add-on

1. In HA: **Settings** → **Add-ons** → **Add-on Store** → **⋮** → **Repositories**
2. Add: `https://github.com/simpleace15/hermes-ha-addon`
3. Find **Hermes Agent Chat** → click **Install**
4. Configure (see below) → click **Start**

That's it. The add-on appears in your HA sidebar as **Hermes Agent** 🤖

---

## ⚙️ Configuration

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `hermes_host` | **yes** | `http://localhost` | URL of your Hermes host (e.g. `http://192.168.1.100`) |
| `hermes_api_key` | **yes** | _(empty)_ | The `API_SERVER_KEY` from your Hermes profiles |
| `registry_port` | no | `8641` | Port for the profile registry |
| `default_profile` | no | `default` | Profile to auto-select on first load |
| `manual_profiles` | no | `[]` | Fallback: list of `{name, port}` pairs if no registry |
| `log_level` | no | `info` | `debug` / `info` / `warning` / `error` / `critical` |
| `theme` | no | `ha-dark` | `ha-dark` / `ha-light` / `midnight` / `solarized` |

### Example config with manual profiles (no registry)

```yaml
hermes_host: http://10.0.0.50
hermes_api_key: your-secret-key
default_profile: coder
manual_profiles:
  - name: default
    port: 8642
  - name: coder
    port: 8643
  - name: ha
    port: 8644
```

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────┐
│  Home Assistant                              │
│  ┌────────────────────────────────────────┐  │
│  │  HA Add-on (Docker container)          │  │
│  │                                        │  │
│  │  ┌──────────┐     ┌─────────────────┐  │  │
│  │  │  Flask   │────▶│  Vanilla JS     │  │  │
│  │  │  Backend │     │  Frontend       │  │  │
│  │  │  (proxy) │     │  (chat UI)      │  │  │
│  │  └────┬─────┘     └─────────────────┘  │  │
│  │       │ HTTP / SSE proxy               │  │
│  └───────┼────────────────────────────────┘  │
└──────────┼───────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────┐
│  Hermes Agent Host (separate machine)         │
│                                               │
│  ┌──────────────────────────────────────┐    │
│  │  Profile Registry (:8641)            │    │
│  └──────────────────────────────────────┘    │
│                                               │
│  ┌────────┐  ┌────────┐  ┌────────┐         │
│  │ default│  │ coder  │  │  ha    │  ...    │
│  │ :8642  │  │ :8643  │  │ :8644  │         │
│  └────────┘  └────────┘  └────────┘         │
└──────────────────────────────────────────────┘
```

**How it works:**

1. The Flask backend proxies all API calls to your Hermes instance — the frontend never touches the Hermes API directly
2. The profile registry discovers which profiles have API servers running and on which ports
3. Chat uses SSE streaming — tokens appear live as the agent generates them
4. HA Ingress handles authentication — no separate login needed

### API Endpoints Proxied

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/chat/completions` | POST | Streaming chat (SSE) |
| `/v1/responses` | POST | Responses API with run events |
| `/v1/runs/{id}` | GET | Run status |
| `/v1/runs/{id}/events` | GET | Run events stream |
| `/v1/runs/{id}/stop` | POST | Stop a running run |
| `/v1/runs/{id}/approval` | POST | Tool approval response |
| `/v1/models` | GET | Available models |
| `/v1/skills` | GET | Installed skills |
| `/v1/toolsets` | GET/PATCH | Toolset listing and toggle |
| `/v1/capabilities` | GET | API capabilities |
| `/health/detailed` | GET | Health + platform status |
| `/api/sessions` | GET/POST/DELETE | Session CRUD |
| `/api/sessions/{id}` | GET/PATCH | Session get/rename |
| `/api/sessions/{id}/messages` | GET | Session message history |
| `/api/sessions/{id}/fork` | POST | Fork a session |

---

## 🎯 Usage

### Chatting

1. Select a profile from the dropdown (top center)
2. Type a message and press **Enter** (Shift+Enter for newline)
3. Watch the response stream in real-time
4. Tool executions appear as inline cards
5. Token usage appears in a metadata bar below each response

### Session Management

- **New Session**: Click the button or `Ctrl+N`
- **Resume**: Click any session in the sidebar
- **Rename**: Double-click a session title
- **Search**: Type in the search bar to filter
- **Delete**: Click the 🗑 icon (hover to reveal)
- **Export**: Click "Export Session (MD)" or "Export Session (JSON)"

### Slash Commands

Type `/` to see autocomplete:

| Command | Description |
|---------|-------------|
| `/new` | Start a new session |
| `/skills` | List installed skills |
| `/cron` | Show cron jobs |
| `/profile` | Switch profile |
| `/sessions` | List recent sessions |
| `/clear` | Clear chat display |
| `/help` | Show help |
| `/capabilities` | Show profile capabilities |

### Image Upload

- **Paste**: Ctrl+V an image while the input is focused
- **Drag**: Drag and drop an image file onto the input area
- Images show as thumbnails above the input — click ✕ to remove
- Images are sent in OpenAI vision format (`image_url` with base64 data)

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | Newline |
| `↑` / `↓` | Recall message history (when input empty) |
| `Ctrl+K` | Focus input |
| `Ctrl+N` | New session |
| `Ctrl+/` | Show help |
| `Esc` | Close workspace / collapse sidebar |

---

## 🔧 Troubleshooting

<details>
<summary><b>Can't connect to Hermes host</b></summary>

- Verify `hermes_host` is reachable from HA: `curl http://<host>:<port>/health`
- Ensure no firewall is blocking the port(s)
- Use `http://` (not `https://`) for local connections
- Check add-on logs: **Settings** → **Add-ons** → **Hermes Agent Chat** → **Logs**

</details>

<details>
<summary><b>Profile not showing in dropdown</b></summary>

- Confirm the profile's API server is running: `curl http://<host>:<port>/health`
- Verify the registry is running: `curl http://<host>:8641/profiles -H "Authorization: Bearer YOUR_KEY"`
- If not using the registry, add the profile manually in `manual_profiles`

</details>

<details>
<summary><b>Authentication error (401)</b></summary>

- Verify `hermes_api_key` matches the `API_SERVER_KEY` in your Hermes profiles
- All profiles must use the same key (or use `manual_profiles` for per-profile keys)

</details>

<details>
<summary><b>Responses appear all at once (not streaming)</b></summary>

- Usually a proxy buffering issue
- If behind a reverse proxy, disable response buffering for the add-on path
- The add-on sets `X-Accel-Buffering: no` but some proxies need explicit config

</details>

<details>
<summary><b>Token usage not showing</b></summary>

- Fixed in v1.1.4 — ensure you're on the latest version
- The browser may cache old JS — try hard refresh (Ctrl+Shift+R)
- Check browser console (F12) for `[hermes] Captured usage:` logs

</details>

---

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS (no build step, no dependencies) |
| Backend | Python / Flask |
| Runtime | HA Add-on Docker container (`ghcr.io/home-assistant/base:3.24`) |
| Protocol | HTTP + SSE (Server-Sent Events) |
| API | Hermes Agent REST API (OpenAI-compatible chat completions + Responses API) |

---

## 📋 Changelog

See [CHANGELOG.md](hermes_ha_addon/CHANGELOG.md) for full release history.

### v1.3.0 — Feature Complete
10 new features including image upload, toolset manager, health indicator, browser notifications, JSON export, markdown preview, tool call history, auto-theme, retry countdown, and session stats.

### v1.2.0 — Bug Fixes & Code Quality
Fixed session rename, removed nested git repo, added config validation, shared utils.js, request timeouts, global error boundary, Responses API routes, session previews.

### v1.1.x — Foundation
Token usage metadata, profile name labels, SSE tool streaming, approval dialogs, model selector, skills browser, themes, syntax highlighting, workspace browser.

---

## 🤝 Contributing

PRs welcome! The codebase is intentionally framework-free — vanilla JS and Flask. No build step, no npm, no webpack.

```bash
# Clone
git clone https://github.com/simpleace15/hermes-ha-addon.git

# Structure
hermes_ha_addon/
├── app.py              # Flask backend (routes, proxy, config)
├── hermes_proxy.py     # Hermes API client logic
├── profile_registry.py # Profile auto-discovery
├── static/
│   ├── index.html      # Single-page app shell
│   ├── app.js          # Main app logic, profile management
│   ├── chat.js         # Chat, SSE streaming, image upload, notifications
│   ├── sessions.js     # Session list, rename, export, tool call history
│   ├── workspace.js    # File browser, skills browser, toolset manager
│   ├── themes.js       # Theme system (4 themes + auto-detection)
│   ├── markdown.js     # Markdown renderer + syntax highlighter
│   ├── commands.js     # Slash command system
│   ├── utils.js        # Shared utilities (escapeHtml, fetchWithTimeout)
│   └── style.css       # All styling (CSS variables per theme)
├── registry/
│   ├── hermes_profile_registry.py  # Profile discovery service
│   └── install.sh                  # One-command installer
├── config.yaml         # HA add-on manifest
├── Dockerfile          # Container build
└── run.sh              # Container entrypoint
```

---

## License

MIT