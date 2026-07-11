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