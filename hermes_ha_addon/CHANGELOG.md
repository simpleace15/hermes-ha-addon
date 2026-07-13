## 1.3.0 (2026-07-12)

### New Features (10 features from audit)
- **Session stats in sidebar**: tool call count, total token usage, estimated cost, and model badges per session
- **Health indicator**: status bar shows Hermes response latency (ms), version, active agent count, and connected platforms via `/health/detailed`
- **Browser notifications**: desktop notification + title bar flash when response completes and tab isn't focused
- **Auto-theme detection**: respects system `prefers-color-scheme` for initial theme (no more forcing dark on light-mode users)
- **Session JSON export**: full session metadata + all messages (including tool calls) as downloadable JSON file
- **Connection retry countdown**: shows "Reconnecting in Ns..." with countdown timer instead of ambiguous spinner
- **Tool call history in loaded sessions**: tool messages now show as collapsed cards instead of being hidden
- **Image upload**: paste or drag-drop images into chat input, sends as OpenAI vision format (base64 `image_url`), with preview thumbnails and remove button
- **Toolset browser**: new "Tools" tab in workspace panel — shows all toolsets with enable/disable toggle switches, tool tags, and configuration status
- **Markdown input preview**: eye icon toggles between raw text input and rendered markdown preview

### Data Fields Now Used (4 new)
- `tool_call_count` → 🔧 badge in sidebar
- `input_tokens` / `output_tokens` → 📊 total tokens badge in sidebar
- `estimated_cost_usd` → cost badge in sidebar
- `model` → model name badge in sidebar

## 1.2.0 (2026-07-12)

### Bug Fixes
- **Session rename fixed** — API returns session object nested under `session` key; `createSession` and `forkSession` now correctly extract `session.id`
- **Nested git repo removed** — `hermes-ha-addon/hermes-ha-addon/` submodule reference cleaned up
- **Config validation** — clear error logged when HERMES_HOST or HERMES_API_KEY not configured, with prominent error banner in UI
- **Workspace browser improved** — 30s cache for directory listings, "Refresh" button bypasses cache, 120s timeout (was 60s), better prompt to reduce agent commentary
- **stream_options** — no longer sends empty `{}` to Hermes if frontend doesn't include it
- **HERMES_BASE fallback** — defaults to `''` instead of undefined when not in Ingress mode

### Code Quality
- **Shared utils.js** — `escapeHtml`, `escapeAttr`, `truncate`, `fetchWithTimeout` extracted from 5 duplicate implementations into one file
- **Request timeouts** — all non-streaming fetch calls now use `fetchWithTimeout` (10-15s for API calls, 120s for workspace)
- **Global error boundary** — `unhandledrejection` listener catches promise rejections and shows status bar error
- **Dead code removed** — `session_chat_stream` method and route deleted (frontend uses `/api/chat` instead)
- **Theme icon clickable** — clicking the emoji cycles through themes
- **CSS fix** — `pre { position: relative }` moved to the main pre styles, removed duplicate at bottom

### New Features
- **Session preview in sidebar** — shows first message snippet (like ChatGPT) from `preview` field
- **Session metadata in sidebar** — message count badge next to each session
- **Message input history** — press Up arrow (empty input) to recall previous messages, Down to go forward
- **Responses API routes** — `/api/responses`, `/api/runs/{id}`, `/api/runs/{id}/events`, `/api/runs/{id}/stop` proxy endpoints for the richer Hermes Responses API

## 1.1.4 (2026-07-12)

### Fixed
- **Browser caching**: static files now served with `Cache-Control: no-cache, no-store, must-revalidate` headers
- Added cache-busting query strings (`?v=114`) to all script/CSS includes in index.html
- This was the root cause of token usage not appearing — the browser was serving cached v1.1.0 `chat.js` even after updating the add-on

### Added
- Debug logging in chat endpoint: logs `stream_options` value, chunk count, and whether usage was seen
- Console logging in frontend: `console.log('[hermes] Captured usage: ...')` and `console.log('[hermes] Stream done: ...')`
- Use browser DevTools console (F12) to verify usage data is being captured

## 1.1.3 (2026-07-12)

### Changed
- Assistant message label now shows the active profile name instead of "assistant"
- User message label shows "You" instead of "user"

## 1.1.2 (2026-07-12)

### Fixed
- Token usage not showing: backend wasn't forwarding `stream_options` to the Hermes API
- `chat_stream()` now accepts and forwards `stream_options` parameter
- `chat()` route now extracts `stream_options` from request and passes to proxy

## 1.1.1 (2026-07-12)

### Added
- **Token usage metadata**: each assistant response now shows a metadata bar with:
  - 🤖 Model name
  - 📊 Token counts (prompt↑, completion↓, total)
  - ⏱ Response time in seconds
- Added `stream_options: {include_usage: true}` to chat requests so the Hermes API
  includes token counts in the final SSE chunk

## 1.1.0 (2026-07-12)

### Added
- **Tool approval dialog**: when the agent needs approval for a risky tool, shows
  an inline approve/deny dialog with the command and reason — no more silent auto-run
- **Tool streaming display**: fixed SSE parsing to handle named `event: hermes.tool.progress`
  lines — tool progress cards now show emoji, name, label, and completion status correctly
- **Model selector**: dropdown in header to pick which model to use for chat
- **Skills browser**: workspace panel now has Files/Skills tabs — browse installed skills
  and click to invoke them
- **Session rename**: double-click a session title to rename it inline (PATCH endpoint)
- **Session export**: download a session as a markdown file
- **Code copy buttons**: hover over any code block to get a copy button
- **Syntax highlighting**: lightweight highlighter for Python, JS/TS, Bash, SQL, Go, Rust,
  YAML, JSON, Dockerfile — no external dependencies (works in HA Ingress)
- **Keyboard shortcuts**: Ctrl+K focus input, Ctrl+N new session, Ctrl+/ help, Esc close panels
- **Auto-reconnect**: SSE stream auto-retries on network drop (up to 2 attempts with backoff)
- **Per-session streaming**: new `/api/sessions/{id}/chat/stream` route for session chat

### Fixed
- SSE parsing: now correctly handles `event:` named event lines (was only looking at `data:` lines)
- Tool progress events: event type is in the SSE `event:` field, not the JSON body

## 1.0.9 (2026-07-12)

### Added
- **Workspace file browser**: click the workspace icon to browse files on the active
  Hermes profile — lists directories, reads files, navigates with back/refresh buttons.
  Uses the agent's file tools (search_files, read_file) via non-streaming chat calls.
- **Theme system**: 4 built-in themes selectable from the header dropdown —
  HA Dark, HA Light, Midnight Purple, Solarized. Choice is saved in localStorage
  and can be overridden by the `theme` option in HA add-on config.

### Changed
- CSS variables now use `[data-theme]` attribute selectors instead of `@media prefers-color-scheme`
- Theme applied immediately on page load (no flash of wrong theme)
- `themes.js` loaded before other scripts

## 1.0.8 (2026-07-12)

### Fixed
- HA base image tag: `2026.06.1` (git tag) → `3.24` (actual ghcr.io container tag) — build was failing because the image tag didn't exist on the container registry

## 1.0.7 (2026-07-12)

### Changed
- Pin HA base image to `3.24` instead of `:latest` for reproducible builds
- Add `stage: "experimental"` to config.yaml
- Add `.dockerignore` to exclude dev files, `__pycache__`, and `.venv` from build context

### Removed
- `mock_hermes_server.py` — dev/test file, not needed in production add-on
- `session_chat_stream()` — dead code in `hermes_proxy.py`, never called by any route

## 1.0.6 (2026-07-11)

### Fixed
- Session list: parse Hermes API response format `{object: "list", data: [...]}` correctly
- Session messages: same fix — was looking for `messages.messages` instead of `data.data`
- Timestamps: Hermes uses Unix timestamps (float), not ISO strings — multiply by 1000 for JS Date
- Session render: use `last_active` field (what Hermes actually returns) instead of `updated_at`
- Tool messages in history are now skipped in display (they're JSON, not chat messages)

### Added
- Session resume: loading a session now populates the chat messages array so you can continue
  the conversation — new messages are sent with the session_id to maintain continuity

## 1.0.5 (2026-07-11)

### Fixed
- Registry script now queries /v1/models on each port and reports the **actual** running
  model name instead of what's in .env — fixes mismatch where port 8642 says "default" in
  config but network-admin is actually running there

## 1.0.4 (2026-07-11)

### Fixed
- **Ingress path prefix**: all frontend fetch() calls now prepend the HA Ingress token prefix
  (window.HERMES_BASE) so they resolve correctly under /api/hassio_ingress/<token>/
  instead of hitting the HA root path and getting 404s
- Frontend was loading (HTML/CSS/JS served fine) but no API calls reached the backend

## 1.0.3 (2026-07-11)

### Added
- Configurable log level: debug, info, warning, error, critical (dropdown in HA add-on config)
- Detailed logging on all API routes: profile discovery, session CRUD, chat streaming
- Debug-level logging of every HTTP request/response to Hermes (URL, status, body)
- Traceback logging on all exceptions when debug enabled

### Fixed
- Profile discovery now logs which URL it's fetching and what it got back
- Session endpoints now log the target profile, port, and Hermes response status

## 1.0.2 (2026-07-11)

### Fixed
- Config options not loading: replaced bashio with direct jq parsing of /data/options.json
- bashio was getting "forbidden" from Supervisor API — direct file read needs no API access
- All config values (host, key, port, profile) were coming back empty

## 1.0.1 (2026-07-11)

### Fixed
- Add-on not starting: Dockerfile had no CMD instruction — container started and exited immediately
- Switched run.sh to bashio for config parsing
- Dockerfile: use HA base image (ghcr.io/home-assistant/base) instead of python:3.12-slim
- Dockerfile: add io.hass.version/type/arch labels (required by HA Supervisor)
- config.yaml: fix hermes_host schema from url to str (empty string fails URL validation)

## 1.0.0 (2026-07-10)

### Added
- Initial release
- Three-panel chat UI (session sidebar, chat, workspace browser)
- SSE streaming chat with real-time token rendering
- Tool progress indicators (hermes.tool.progress events)
- Profile auto-discovery via registry endpoint
- Manual profile config fallback
- Session management: list, create, resume, fork, delete
- Slash commands: /new, /skills, /cron, /profile, /help with autocomplete
- Workspace file browser (optional)
- HA Ingress support with path prefix handling
- Profile registry script with systemd install
- Dark theme matching HA defaults
- Mobile responsive layout