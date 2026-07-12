/**
 * sessions.js — Session list management (list, create, resume, delete, fork).
 */
(function () {
    'use strict';

    class SessionManager {
        constructor(app) {
            this.app = app;
            this.sessions = [];
            this.activeSessionId = null;
            this.searchQuery = '';

            // Bind UI events
            this._bindEvents();
        }

        _bindEvents() {
            // New session button
            document.getElementById('new-session-btn').addEventListener('click', () => {
                this.createSession();
            });

            // Export session button
            const exportBtn = document.getElementById('export-session-btn');
            if (exportBtn) {
                exportBtn.addEventListener('click', () => {
                    this.exportSession();
                });
            }

            // Session search
            document.getElementById('session-search').addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase();
                this.render();
            });
        }

        /**
         * Fetch sessions from the backend for the active profile.
         */
        async fetchSessions() {
            try {
                const resp = await fetch(`${HERMES_BASE}/api/sessions?profile=${this.app.activeProfile}&limit=50`);
                if (!resp.ok) {
                    console.error('Failed to fetch sessions:', resp.status);
                    this.sessions = [];
                    this.render();
                    return;
                }
                const data = await resp.json();
                // Hermes API returns {object: "list", data: [...]}
                this.sessions = Array.isArray(data) ? data : (data.data || data.sessions || data.items || []);
                this.render();
            } catch (e) {
                console.error('Session fetch error:', e);
                this.sessions = [];
                this.render();
            }
        }

        /**
         * Create a new session.
         */
        async createSession(title) {
            try {
                const resp = await fetch(HERMES_BASE + '/api/sessions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json',
                                'X-Hermes-Profile': this.app.activeProfile },
                    body: JSON.stringify({ title: title || null }),
                });

                if (!resp.ok) {
                    console.error('Create session failed:', resp.status);
                    this.app.setStatus('Failed to create session', 'error');
                    return null;
                }

                const session = await resp.json();
                this.activeSessionId = session.id || session.session_id;
                this.app.clearChat();
                this.app.setStatus('New session started', 'ok');
                this.fetchSessions(); // Refresh list
                return this.activeSessionId;
            } catch (e) {
                console.error('Create session error:', e);
                this.app.setStatus('Failed to create session', 'error');
                return null;
            }
        }

        /**
         * Load a session's messages and display them.
         */
        async loadSession(sessionId) {
            this.activeSessionId = sessionId;
            this.app.clearChat();
            this.app.setStatus('Loading session...', 'connecting');

            try {
                const resp = await fetch(
                    `${HERMES_BASE}/api/sessions/${sessionId}/messages?profile=${this.app.activeProfile}`
                );
                if (!resp.ok) {
                    console.error('Load session failed:', resp.status);
                    this.app.setStatus('Failed to load session', 'error');
                    return;
                }

                const result = await resp.json();
                // Hermes API returns {object: "list", data: [...]}
                const msgs = Array.isArray(result) ? result : (result.data || result.messages || []);

                // Populate chat messages array so subsequent sends continue the conversation
                this.app.chatManager.messages = [];

                msgs.forEach(msg => {
                    const role = msg.role || 'assistant';
                    let content = msg.content || '';
                    // Handle tool messages — content may be JSON
                    if (role === 'tool' || role === 'function') {
                        // Skip tool messages in display, but keep for context
                        return;
                    }
                    // Handle content arrays (some APIs return content as array of parts)
                    if (Array.isArray(content)) {
                        content = content.map(c => typeof c === 'string' ? c : (c.text || JSON.stringify(c))).join('');
                    }
                    this.app.chatManager.messages.push({ role: role, content: content });
                    this.app.displayMessage(role, content, false);
                });

                this.app.setStatus(`Loaded session (${msgs.length} messages)`, 'ok');
                this.render(); // Update active highlight
            } catch (e) {
                console.error('Load session error:', e);
                this.app.setStatus('Failed to load session', 'error');
            }
        }

        /**
         * Delete a session.
         */
        async deleteSession(sessionId) {
            try {
                const resp = await fetch(
                    `${HERMES_BASE}/api/sessions/${sessionId}?profile=${this.app.activeProfile}`,
                    { method: 'DELETE' }
                );
                if (!resp.ok) {
                    console.error('Delete session failed:', resp.status);
                    this.app.setStatus('Failed to delete session', 'error');
                    return;
                }

                if (this.activeSessionId === sessionId) {
                    this.activeSessionId = null;
                    this.app.clearChat();
                }

                this.app.setStatus('Session deleted', 'ok');
                this.fetchSessions();
            } catch (e) {
                console.error('Delete session error:', e);
                this.app.setStatus('Failed to delete session', 'error');
            }
        }

        /**
         * Fork a session.
         */
        async forkSession(sessionId) {
            try {
                const resp = await fetch(
                    `${HERMES_BASE}/api/sessions/${sessionId}/fork?profile=${this.app.activeProfile}`,
                    { method: 'POST' }
                );
                if (!resp.ok) {
                    console.error('Fork session failed:', resp.status);
                    this.app.setStatus('Failed to fork session', 'error');
                    return;
                }

                const forked = await resp.json();
                this.app.setStatus('Session forked', 'ok');
                this.fetchSessions();
                if (forked.id || forked.session_id) {
                    this.loadSession(forked.id || forked.session_id);
                }
            } catch (e) {
                console.error('Fork session error:', e);
                this.app.setStatus('Failed to fork session', 'error');
            }
        }

        /**
         * Render the session list in the sidebar.
         */
        render() {
            const container = document.getElementById('session-list');
            if (!container) return;

            let sessions = this.sessions;
            if (this.searchQuery) {
                sessions = sessions.filter(s => {
                    const title = (s.title || 'Untitled').toLowerCase();
                    return title.includes(this.searchQuery);
                });
            }

            if (sessions.length === 0) {
                container.innerHTML = '<div class="session-empty">No sessions found.<br>Click "New Session" to start.</div>';
                return;
            }

            let html = '';
            sessions.forEach(s => {
                const id = s.id || s.session_id || s.uuid;
                const title = s.title || s.summary || 'Untitled';
                const source = s.source || s.channel || 'cli';
                const time = this._formatTime(s.last_active || s.started_at || s.updated_at || s.created_at);
                const isActive = id === this.activeSessionId;

                html += `<div class="session-item ${isActive ? 'active' : ''}" data-session-id="${id}">`;
                html += `<div class="session-title">${this._escapeHtml(title)}</div>`;
                html += `<div class="session-meta">`;
                html += `<span class="session-source">${source}</span>`;
                html += `<span>${time}</span>`;
                html += `<span class="session-delete" data-delete="${id}" title="Delete">🗑</span>`;
                html += `</div>`;
                html += `</div>`;
            });

            container.innerHTML = html;

            // Bind click events
            container.querySelectorAll('.session-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    // Check if delete was clicked
                    if (e.target.dataset.delete) {
                        e.stopPropagation();
                        if (confirm('Delete this session?')) {
                            this.deleteSession(e.target.dataset.delete);
                        }
                        return;
                    }
                    const sessionId = item.dataset.sessionId;
                    this.loadSession(sessionId);
                });

                // Double-click on session title to rename inline
                const titleEl = item.querySelector('.session-title');
                if (titleEl) {
                    titleEl.addEventListener('dblclick', (e) => {
                        e.stopPropagation();
                        this._startRename(item, titleEl);
                    });
                }
            });
        }

        /**
         * Begin inline rename of a session title.
         */
        _startRename(itemEl, titleEl) {
            const sessionId = itemEl.dataset.sessionId;
            const currentTitle = titleEl.textContent;

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'session-rename-input';
            input.value = currentTitle;
            titleEl.replaceWith(input);
            input.focus();
            input.select();

            let finished = false;
            const finish = async (save) => {
                if (finished) return;
                finished = true;
                const newTitle = input.value.trim();
                if (save && newTitle && newTitle !== currentTitle) {
                    await this._renameSession(sessionId, newTitle);
                } else {
                    // Restore title
                    const span = document.createElement('div');
                    span.className = 'session-title';
                    span.textContent = currentTitle;
                    if (input.parentNode) {
                        input.replaceWith(span);
                        // Re-bind dblclick
                        span.addEventListener('dblclick', (e) => {
                            e.stopPropagation();
                            this._startRename(itemEl, span);
                        });
                    }
                }
            };

            input.addEventListener('blur', () => finish(true));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    finished = true;
                    const span = document.createElement('div');
                    span.className = 'session-title';
                    span.textContent = currentTitle;
                    if (input.parentNode) {
                        input.replaceWith(span);
                        span.addEventListener('dblclick', (ev) => {
                            ev.stopPropagation();
                            this._startRename(itemEl, span);
                        });
                    }
                }
            });
        }

        async _renameSession(sessionId, newTitle) {
            try {
                const resp = await fetch(`${HERMES_BASE}/api/sessions/${sessionId}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Hermes-Profile': this.app.activeProfile,
                    },
                    body: JSON.stringify({ title: newTitle }),
                });
                if (!resp.ok) {
                    console.error('Rename session failed:', resp.status);
                    this.app.setStatus('Failed to rename session', 'error');
                    return;
                }
                this.app.setStatus('Session renamed', 'ok');
                this.fetchSessions();
            } catch (e) {
                console.error('Rename session error:', e);
                this.app.setStatus('Failed to rename session', 'error');
            }
        }

        /**
         * Export the active session's messages as a Markdown file.
         */
        async exportSession() {
            if (!this.activeSessionId) {
                this.app.setStatus('No active session to export', 'error');
                return;
            }
            this.app.setStatus('Exporting session...', 'connecting');
            try {
                const resp = await fetch(
                    `${HERMES_BASE}/api/sessions/${this.activeSessionId}/messages?profile=${this.app.activeProfile}`
                );
                if (!resp.ok) {
                    console.error('Export: failed to fetch messages:', resp.status);
                    this.app.setStatus('Failed to export session', 'error');
                    return;
                }
                const result = await resp.json();
                const msgs = Array.isArray(result) ? result : (result.data || result.messages || []);

                let md = `# Session Export: ${this.activeSessionId}\n\n`;
                msgs.forEach(msg => {
                    const role = msg.role || 'assistant';
                    if (role === 'tool' || role === 'function') return;
                    let content = msg.content || '';
                    if (Array.isArray(content)) {
                        content = content.map(c => typeof c === 'string' ? c : (c.text || JSON.stringify(c))).join('');
                    }
                    md += `## ${role}\n\n${content}\n\n---\n\n`;
                });

                const blob = new Blob([md], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `session_${this.activeSessionId}.md`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                this.app.setStatus('Session exported', 'ok');
            } catch (e) {
                console.error('Export session error:', e);
                this.app.setStatus('Failed to export session', 'error');
            }
        }

        _formatTime(ts) {
            if (!ts) return '';
            // Hermes uses Unix timestamps (float), handle both float and ISO string
            let d;
            if (typeof ts === 'number') {
                d = new Date(ts * 1000); // Unix seconds → milliseconds
            } else if (typeof ts === 'string' && !isNaN(ts)) {
                d = new Date(parseFloat(ts) * 1000);
            } else {
                d = new Date(ts);
            }
            if (isNaN(d.getTime())) return String(ts);
            const now = new Date();
            const diff = (now - d) / 1000;
            if (diff < 60) return 'just now';
            if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
            if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
            if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
            return d.toLocaleDateString();
        }

        _escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        /**
         * Clear sessions when switching profiles.
         */
        clear() {
            this.sessions = [];
            this.activeSessionId = null;
            this.render();
        }
    }

    window.SessionManager = SessionManager;
})();