/**
 * app.js — Main application logic.
 * Initializes all managers, handles profile switching, sidebar toggling,
 * and global state.
 */
(function () {
    'use strict';

    class HermesApp {
        constructor() {
            this.profiles = [];
            this.activeProfile = localStorage.getItem('hermes_active_profile') || 'default';
            this.activeModel = null;
            this.sessionManager = null;
            this.chatManager = null;
            this.workspace = null;
            this.commandDropdownVisible = false;
        }

        async init() {
            // Initialize managers
            this.sessionManager = new SessionManager(this);
            this.chatManager = new ChatManager(this);
            this.workspace = new WorkspaceBrowser(this);

            // Bind UI events
            this._bindEvents();

            // Load profiles
            await this.loadProfiles();

            // Fetch sessions for active profile
            if (this.activeProfile) {
                this.sessionManager.fetchSessions();
            }

            this.setStatus('Ready', 'ok');
        }

        _bindEvents() {
            // Sidebar toggle
            document.getElementById('sidebar-toggle').addEventListener('click', () => {
                document.getElementById('sidebar').classList.toggle('collapsed');
            });

            // Profile selector
            document.getElementById('profile-selector').addEventListener('change', (e) => {
                this.switchProfile(e.target.value);
            });

            // Close error banners (event delegation)
            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('close-error')) {
                    e.target.closest('.error-banner')?.remove();
                }
                // Command dropdown items
                if (e.target.closest('.command-item')) {
                    const item = e.target.closest('.command-item');
                    const cmd = item.dataset.cmd;
                    if (cmd) {
                        document.getElementById('message-input').value = cmd + ' ';
                        document.getElementById('message-input').focus();
                        document.getElementById('command-dropdown').style.display = 'none';
                    }
                }
            });
        }

        // ── Profile Management ─────────────────────────────────────────

        async loadProfiles() {
            this.setStatus('Discovering profiles...', 'connecting');

            try {
                const resp = await fetch(HERMES_BASE + '/api/profiles');
                if (!resp.ok) {
                    this.setStatus('Failed to discover profiles', 'error');
                    this._renderProfileError('Could not reach the profile registry');
                    return;
                }

                const data = await resp.json();
                this.profiles = data.profiles || [];

                if (this.profiles.length === 0) {
                    this._renderProfileError('No profiles found. Check your Hermes host configuration.');
                    return;
                }

                this._renderProfileSelector();

                // Set active profile
                const defaultProfile = data.default || 'default';
                if (!this.activeProfile || !this.profiles.find(p => p.name === this.activeProfile)) {
                    this.activeProfile = defaultProfile;
                }

                // Update selector
                document.getElementById('profile-selector').value = this.activeProfile;

                // Update model name display
                const profile = this.profiles.find(p => p.name === this.activeProfile);
                this.activeModel = profile ? profile.model : null;
                this._updateModelDisplay();

                // Check connection
                this._checkConnection();

            } catch (e) {
                console.error('Profile load error:', e);
                this.setStatus('Profile discovery failed', 'error');
                this._renderProfileError(e.message);
            }
        }

        _renderProfileSelector() {
            const selector = document.getElementById('profile-selector');
            let html = '';
            this.profiles.forEach(p => {
                const status = p.status || 'unknown';
                const label = `${p.name} (${p.port}) ${status === 'offline' ? '⚠️' : ''}`;
                const disabled = status === 'offline';
                html += `<option value="${p.name}" ${disabled ? 'disabled' : ''}>${label}</option>`;
            });
            selector.innerHTML = html;
        }

        _renderProfileError(msg) {
            const selector = document.getElementById('profile-selector');
            selector.innerHTML = `<option value="" disabled>${msg}</option>`;
            this.setConnectionStatus('offline');
        }

        switchProfile(profileName) {
            if (profileName === this.activeProfile) return;

            this.activeProfile = profileName;
            localStorage.setItem('hermes_active_profile', profileName);

            // Update model
            const profile = this.profiles.find(p => p.name === profileName);
            this.activeModel = profile ? profile.model : null;
            this._updateModelDisplay();

            // Clear state
            this.chatManager.clear();
            this.sessionManager.clear();

            // Reload sessions
            this.sessionManager.fetchSessions();

            this.setStatus(`Switched to ${profileName}`, 'ok');
            this._checkConnection();
        }

        _updateModelDisplay() {
            const el = document.getElementById('model-name');
            if (this.activeModel) {
                el.textContent = `model: ${this.activeModel}`;
            } else {
                el.textContent = '';
            }
        }

        async _checkConnection() {
            this.setConnectionStatus('connecting');
            try {
                const resp = await fetch(`${HERMES_BASE}/api/capabilities?profile=${this.activeProfile}`);
                if (resp.ok) {
                    this.setConnectionStatus('online');
                } else {
                    this.setConnectionStatus('offline');
                }
            } catch {
                this.setConnectionStatus('offline');
            }
        }

        // ── Public API for commands.js ──────────────────────────────────

        newSession() {
            this.sessionManager.createSession();
        }

        showProfileSelector() {
            document.getElementById('profile-selector').focus();
        }

        showHelp() {
            const helpText = `## Available Commands

| Command | Description |
|---------|-------------|
| \`/new\` | Start a new session |
| \`/skills\` | List installed skills |
| \`/cron\` | Show cron jobs |
| \`/profile\` | Switch profile |
| \`/sessions\` | List recent sessions |
| \`/clear\` | Clear chat display |
| \`/help\` | Show this help |
| \`/capabilities\` | Show profile capabilities |

**Tips:**
- Press \`Enter\` to send, \`Shift+Enter\` for newline
- Type \`/\` to see command autocomplete
- Click the sidebar icon to toggle sessions
- Click the workspace icon to toggle file browser`;
            this.chatManager.displayMessage('assistant', helpText, false);
        }

        showSessionList() {
            const sessions = this.sessionManager.sessions;
            if (sessions.length === 0) {
                this.chatManager.displayMessage('assistant', 'No sessions found.', false);
                return;
            }
            let html = '## Recent Sessions\n\n';
            sessions.forEach((s, i) => {
                const title = s.title || 'Untitled';
                const time = s.updated_at || s.last_activity || '';
                html += `${i + 1}. **${title}** ${time ? `(${time})` : ''}\n`;
            });
            this.chatManager.displayMessage('assistant', html, false);
        }

        clearChat() {
            this.chatManager.clear();
        }

        send(text) {
            this.chatManager.send(text);
        }

        displayMessage(role, content, animate) {
            this.chatManager.displayMessage(role, content, animate);
        }

        // ── Status helpers ──────────────────────────────────────────────

        setStatus(text, level) {
            const el = document.getElementById('status-text');
            el.textContent = text;

            // Color the connection dot based on level
            const dot = document.querySelector('.connection-status .dot');
            if (dot) {
                dot.className = `dot dot-${level === 'ok' ? 'online' : level === 'error' ? 'offline' : 'connecting'}`;
            }
        }

        setConnectionStatus(status) {
            const dot = document.querySelector('.connection-status .dot');
            const label = document.getElementById('connection-label');
            if (dot) dot.className = `dot dot-${status}`;
            if (label) {
                label.textContent = status === 'online' ? 'Connected' :
                    status === 'connecting' ? 'Connecting...' :
                    'Disconnected';
            }
        }
    }

    // ── Initialize on DOM ready ────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        const app = new HermesApp();
        window.hermesApp = app; // Expose for debugging
        app.init();
    });
})();