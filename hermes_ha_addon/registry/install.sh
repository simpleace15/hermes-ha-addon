#!/bin/bash
# install.sh — One-command installer for the Hermes Profile Registry.
#
# Downloads the registry script, creates a systemd user service, and starts it.
# The script reads API_SERVER_KEY from ~/.hermes/.env automatically.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/simpleace15/hermes-ha-addon/main/registry/install.sh | bash
#
# Or with custom options:
#   curl -fsSL ... | bash -s -- --port 8641 --bind 0.0.0.0

set -e

INSTALL_DIR="$HOME"
SCRIPT_NAME="hermes_profile_registry.py"
SCRIPT_URL="https://raw.githubusercontent.com/simpleace15/hermes-ha-addon/main/hermes_ha_addon/registry/hermes_profile_registry.py"
SERVICE_NAME="hermes-registry"
SERVICE_FILE="$HOME/.config/systemd/user/${SERVICE_NAME}.service"

# Default args (can be overridden via $1)
PORT="${REGISTRY_PORT:-8641}"
BIND="${REGISTRY_BIND:-0.0.0.0}"

echo "╔══════════════════════════════════════════════════╗"
echo "║   Hermes Profile Registry Installer               ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Download the script
echo "→ Downloading ${SCRIPT_NAME}..."
if command -v curl &>/dev/null; then
    curl -fsSL "${SCRIPT_URL}" -o "${INSTALL_DIR}/${SCRIPT_NAME}"
elif command -v wget &>/dev/null; then
    wget -q "${SCRIPT_URL}" -O "${INSTALL_DIR}/${SCRIPT_NAME}"
else
    echo "✗ Neither curl nor wget found. Please install one." >&2
    exit 1
fi
echo "  Downloaded to ${INSTALL_DIR}/${SCRIPT_NAME}"

# Make executable
chmod +x "${INSTALL_DIR}/${SCRIPT_NAME}"

# Create systemd user service
echo "→ Creating systemd user service..."
mkdir -p "$(dirname "${SERVICE_FILE}")"

cat > "${SERVICE_FILE}" << EOF
[Unit]
Description=Hermes Profile Registry
After=network.target

[Service]
ExecStart=/usr/bin/python3 ${INSTALL_DIR}/${SCRIPT_NAME} --port ${PORT} --bind ${BIND}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

echo "  Service file: ${SERVICE_FILE}"

# Enable lingering so the user service starts on boot
if command -v loginctl &>/dev/null; then
    loginctl enable-linger "$USER" 2>/dev/null || true
fi

# Reload and start
echo "→ Enabling and starting service..."
systemctl --user daemon-reload
systemctl --user enable --now "${SERVICE_NAME}"

echo ""
echo "✓ Installation complete!"
echo ""
echo "  Registry URL: http://$(hostname -I | awk '{print $1}'):${PORT}/profiles"
echo ""
echo "  To check status:   systemctl --user status ${SERVICE_NAME}"
echo "  To view logs:       journalctl --user -u ${SERVICE_NAME} -f"
echo "  To restart:         systemctl --user restart ${SERVICE_NAME}"
echo "  To stop:            systemctl --user stop ${SERVICE_NAME}"
echo "  To uninstall:       systemctl --user disable --now ${SERVICE_NAME} && rm ${SERVICE_FILE} ${INSTALL_DIR}/${SCRIPT_NAME}"