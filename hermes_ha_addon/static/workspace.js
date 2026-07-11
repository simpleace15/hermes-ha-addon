/**
 * workspace.js — Simple workspace file browser.
 * Uses the agent's file tools via chat (sends a message asking the agent
 * to list/read files). This is a secondary feature — kept intentionally simple.
 */
(function () {
    'use strict';

    class WorkspaceBrowser {
        constructor(app) {
            this.app = app;
            this.visible = false;
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
        }

        hide() {
            this.visible = false;
            document.getElementById('workspace').style.display = 'none';
        }

        /**
         * Check if the current profile has file tools available.
         */
        async checkCapabilities() {
            try {
                const resp = await fetch(`${HERMES_BASE}/api/capabilities?profile=${this.app.activeProfile}`);
                if (!resp.ok) return false;
                const data = await resp.json();
                // Check if file tools or file toolset is available
                if (data.tools && Array.isArray(data.tools)) {
                    return data.tools.some(t =>
                        t.includes('file') || t.includes('read') || t.includes('write')
                    );
                }
                if (data.toolsets && Array.isArray(data.toolsets)) {
                    return data.toolsets.some(t => t.includes('file'));
                }
                return true; // Assume yes if we can't tell
            } catch {
                return false;
            }
        }

        /**
         * Request the agent to list files — sends a chat message.
         * This is a simple approach that works without direct file API endpoints.
         */
        async requestFileList() {
            this.app.send('List the files in the current working directory. Show them as a simple tree.');
        }

        /**
         * Render a file tree from agent output (parse markdown/code blocks).
         * This is called when the agent responds to a file listing request.
         */
        renderFileTree(fileListText) {
            const container = document.getElementById('workspace-content');
            if (!fileListText) {
                container.innerHTML = '<div class="workspace-placeholder">No files to display.</div>';
                return;
            }

            // Parse lines that look like file entries
            const lines = fileListText.split('\n').filter(l => l.trim());
            let html = '<div class="file-tree">';
            lines.forEach(line => {
                // Strip common tree characters
                const name = line.replace(/^[│├└─\s]+/, '').replace(/[*] /g, '').trim();
                if (!name) return;

                const isDir = name.endsWith('/') || name.includes('/');
                const icon = isDir ? '📁' : '📄';
                html += `<div class="file-item">`;
                html += `<span class="file-icon">${icon}</span>`;
                html += `<span class="file-name">${this._escapeHtml(name)}</span>`;
                html += `</div>`;
            });
            html += '</div>';
            container.innerHTML = html;
        }

        /**
         * Show a file preview in the workspace panel.
         */
        showPreview(filename, content) {
            const container = document.getElementById('workspace-content');
            let html = '<div class="file-tree">';
            html += `<div class="file-item"><span class="file-icon">📄</span>`;
            html += `<span class="file-name">${this._escapeHtml(filename)}</span></div>`;
            html += '</div>';
            html += `<div class="file-preview">${this._escapeHtml(content)}</div>`;
            container.innerHTML = html;
        }

        _escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    }

    window.WorkspaceBrowser = WorkspaceBrowser;
})();