/**
 * workspace.js — Workspace file browser.
 * Calls backend /api/workspace/list and /api/workspace/read, which
 * ask the Hermes agent to use its file tools (search_files, read_file).
 * The agent executes tools server-side and returns structured results.
 */
(function () {
    'use strict';

    class WorkspaceBrowser {
        constructor(app) {
            this.app = app;
            this.visible = false;
            this.currentPath = '.';
            this.loading = false;
            this.fileTree = [];

            document.getElementById('workspace-toggle').addEventListener('click', () => {
                this.toggle();
            });
            document.getElementById('workspace-close').addEventListener('click', () => {
                this.hide();
            });
        }

        toggle() {
            if (this.visible) this.hide();
            else this.show();
        }

        show() {
            this.visible = true;
            document.getElementById('workspace').style.display = 'flex';
            if (this.fileTree.length === 0) {
                this.listFiles(this.currentPath);
            }
        }

        hide() {
            this.visible = false;
            document.getElementById('workspace').style.display = 'none';
        }

        /**
         * List files at a path via the backend (which asks the agent).
         */
        async listFiles(path) {
            this.currentPath = path;
            this.loading = true;
            this._renderLoading();

            try {
                const resp = await fetch(HERMES_BASE + '/api/workspace/list', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        path: path,
                        profile: this.app.activeProfile,
                    }),
                });

                if (!resp.ok) {
                    const err = await resp.text();
                    this._renderError(`Failed to list files: ${resp.status}`);
                    return;
                }

                const data = await resp.json();
                this.fileTree = this._parseFileList(data.files || '');
                this._renderFileTree();
            } catch (e) {
                console.error('Workspace list error:', e);
                this._renderError(e.message);
            } finally {
                this.loading = false;
            }
        }

        /**
         * Read a file via the backend (which asks the agent to use read_file).
         */
        async readFile(filePath) {
            this._renderLoadingFile(filePath);

            try {
                const resp = await fetch(HERMES_BASE + '/api/workspace/read', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        path: filePath,
                        profile: this.app.activeProfile,
                    }),
                });

                if (!resp.ok) {
                    this._renderError(`Failed to read file: ${resp.status}`);
                    return;
                }

                const data = await resp.json();
                this._renderFilePreview(filePath, data.content || '');
            } catch (e) {
                console.error('Workspace read error:', e);
                this._renderError(e.message);
            }
        }

        /**
         * Parse the agent's text response into a structured file list.
         * Expected format: lines with [DIR] or [FILE] prefix.
         * Falls back to parsing raw lines.
         */
        _parseFileList(text) {
            const lines = text.split('\n').filter(l => l.trim());
            const items = [];

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                // Try structured format: [DIR] path or [FILE] path
                let match = trimmed.match(/^\[DIR\]\s+(.+)/i);
                if (match) {
                    items.push({ name: match[1].trim(), type: 'dir' });
                    continue;
                }
                match = trimmed.match(/^\[FILE\]\s+(.+)/i);
                if (match) {
                    items.push({ name: match[1].trim(), type: 'file' });
                    continue;
                }

                // Fallback: detect by trailing slash or common patterns
                // Skip lines that look like commentary ("Here are the files...")
                if (trimmed.length > 200 || /^(Here|These|I|The|List|Found)\b/i.test(trimmed)) {
                    continue;
                }

                // Strip tree characters
                const name = trimmed.replace(/^[│├└─\s]+/, '').replace(/[*`\s]+$/g, '').trim();
                if (!name || name === '.') continue;

                const isDir = name.endsWith('/');
                items.push({ name, type: isDir ? 'dir' : 'file' });
            }

            return items;
        }

        // ── Rendering ──────────────────────────────────────────────────

        _renderFileTree() {
            const container = document.getElementById('workspace-content');
            const pathDisplay = this.currentPath === '.' ? 'workspace root' : this.currentPath;

            let html = '<div class="workspace-path">' + this._escapeHtml(pathDisplay) + '</div>';
            html += '<div class="file-tree">';

            // Up directory button (unless we're at root)
            if (this.currentPath !== '.') {
                const parentPath = this.currentPath.replace(/\/[^/]+\/?$/, '') || '.';
                html += `<div class="file-item file-up" data-path="${this._escapeHtml(parentPath)}">`;
                html += '<span class="file-icon">📁</span>';
                html += '<span class="file-name">..</span>';
                html += '</div>';
            }

            if (this.fileTree.length === 0) {
                html += '<div class="workspace-placeholder">No files found.</div>';
            } else {
                // Sort: dirs first, then files, alphabetical
                const sorted = [...this.fileTree].sort((a, b) => {
                    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });

                sorted.forEach(item => {
                    const icon = item.type === 'dir' ? '📁' : '📄';
                    const fullPath = item.type === 'dir'
                        ? (this.currentPath === '.' ? item.name : this.currentPath + '/' + item.name)
                        : (this.currentPath === '.' ? item.name : this.currentPath + '/' + item.name);
                    html += `<div class="file-item" data-type="${item.type}" data-path="${this._escapeHtml(fullPath)}">`;
                    html += `<span class="file-icon">${icon}</span>`;
                    html += `<span class="file-name">${this._escapeHtml(item.name)}</span>`;
                    html += '</div>';
                });
            }

            html += '</div>';
            html += '<button class="btn btn-block workspace-refresh" id="workspace-refresh">Refresh</button>';
            container.innerHTML = html;

            // Bind click events
            container.querySelectorAll('.file-item').forEach(item => {
                item.addEventListener('click', () => {
                    const type = item.dataset.type;
                    const path = item.dataset.path;
                    if (type === 'dir' || item.classList.contains('file-up')) {
                        this.listFiles(path);
                    } else {
                        this.readFile(path);
                    }
                });
            });

            const refreshBtn = document.getElementById('workspace-refresh');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => this.listFiles(this.currentPath));
            }
        }

        _renderFilePreview(filename, content) {
            const container = document.getElementById('workspace-content');
            let html = '<div class="workspace-back">';
            html += '<button class="btn btn-block" id="workspace-back-btn">← Back to file list</button>';
            html += '</div>';
            html += `<div class="file-preview-header">`;
            html += `<span class="file-icon">📄</span>`;
            html += `<span class="file-name">${this._escapeHtml(filename)}</span>`;
            html += '</div>';
            html += `<div class="file-preview">${this._escapeHtml(content)}</div>`;
            container.innerHTML = html;

            document.getElementById('workspace-back-btn').addEventListener('click', () => {
                this._renderFileTree();
            });
        }

        _renderLoading() {
            const container = document.getElementById('workspace-content');
            container.innerHTML = '<div class="workspace-loading">Loading files...</div>';
        }

        _renderLoadingFile(filename) {
            const container = document.getElementById('workspace-content');
            container.innerHTML = `<div class="workspace-loading">Reading ${this._escapeHtml(filename)}...</div>`;
        }

        _renderError(msg) {
            const container = document.getElementById('workspace-content');
            container.innerHTML = `<div class="workspace-error">${this._escapeHtml(msg)}</div>`;
        }

        _escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = String(text);
            return div.innerHTML;
        }
    }

    window.WorkspaceBrowser = WorkspaceBrowser;
})();