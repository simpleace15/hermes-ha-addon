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