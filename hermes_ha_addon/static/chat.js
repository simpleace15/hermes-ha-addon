/**
 * chat.js — Chat send/receive, SSE streaming, message rendering.
 *
 * Uses fetch() with ReadableStream for SSE (not EventSource, because
 * EventSource only supports GET and we need POST).
 */
(function () {
    'use strict';

    class ChatManager {
        constructor(app) {
            this.app = app;
            this.isStreaming = false;
            this.abortController = null;
            this.currentStream = null;

            // Message history for the current session (sent to API)
            this.messages = [];

            this._bindEvents();
        }

        _bindEvents() {
            const input = document.getElementById('message-input');
            const sendBtn = document.getElementById('send-btn');
            const stopBtn = document.getElementById('stop-btn');

            // Enter to send (Shift+Enter for newline)
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.send();
                }
            });

            // Auto-resize textarea
            input.addEventListener('input', () => {
                input.style.height = 'auto';
                input.style.height = Math.min(input.scrollHeight, 200) + 'px';

                // Slash command autocomplete
                this._handleCommandAutocomplete(input.value);
            });

            // Command dropdown navigation
            input.addEventListener('keydown', (e) => {
                if (this._commandState && this._commandState.visible) {
                    this._handleCommandKeydown(e);
                }
            });

            sendBtn.addEventListener('click', () => this.send());
            stopBtn.addEventListener('click', () => this.stop());
        }

        // ── Slash command autocomplete ─────────────────────────────────

        _handleCommandAutocomplete(value) {
            if (!value.startsWith('/')) {
                this._hideCommandDropdown();
                return;
            }

            const spaceIdx = value.indexOf(' ');
            if (spaceIdx !== -1) {
                this._hideCommandDropdown();
                return;
            }

            const commands = SlashCommands.filter(value);
            if (commands.length > 0) {
                this._commandState = {
                    visible: true,
                    commands,
                    selectedIndex: 0,
                };
                SlashCommands.renderDropdown(commands, 0);
            } else {
                this._hideCommandDropdown();
            }
        }

        _handleCommandKeydown(e) {
            const state = this._commandState;
            if (!state || !state.visible) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                state.selectedIndex = Math.min(state.selectedIndex + 1, state.commands.length - 1);
                SlashCommands.renderDropdown(state.commands, state.selectedIndex);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                state.selectedIndex = Math.max(state.selectedIndex - 1, 0);
                SlashCommands.renderDropdown(state.commands, state.selectedIndex);
            } else if (e.key === 'Tab' || (e.key === 'Enter' && state.commands[state.selectedIndex])) {
                e.preventDefault();
                const cmd = state.commands[state.selectedIndex];
                document.getElementById('message-input').value = cmd.name + ' ';
                this._hideCommandDropdown();
            } else if (e.key === 'Escape') {
                this._hideCommandDropdown();
            }
        }

        _hideCommandDropdown() {
            document.getElementById('command-dropdown').style.display = 'none';
            this._commandState = null;
        }

        // ── Send message ────────────────────────────────────────────────

        async send(textOverride) {
            const input = document.getElementById('message-input');
            const text = textOverride || input.value.trim();
            if (!text || this.isStreaming) return;

            // Check for slash commands
            const parsed = SlashCommands.parse(text);
            if (parsed && parsed.isCommand && !parsed.passthrough) {
                const handled = SlashCommands.handleLocal(parsed, this.app);
                if (handled) {
                    input.value = '';
                    input.style.height = 'auto';
                    this._hideCommandDropdown();
                    return;
                }
            }

            // Display user message
            this.displayMessage('user', text);
            input.value = '';
            input.style.height = 'auto';
            this._hideCommandDropdown();

            // Build messages array for API
            // If it's a passthrough command, send as-is; otherwise send the raw text
            const msgContent = parsed && parsed.isCommand ? parsed.raw : text;
            this.messages.push({ role: 'user', content: msgContent });

            // Start streaming
            await this._streamChat(this.messages);
        }

        // ── SSE Streaming ───────────────────────────────────────────────

        async _streamChat(messages) {
            this.isStreaming = true;
            this._setStreamingUI(true);
            this.app.setStatus('Sending...', 'connecting');

            // Create the assistant message bubble for streaming
            const msgEl = this._createMessageElement('assistant');
            const bubble = msgEl.querySelector('.message-bubble');
            bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
            this._scrollToBottom();

            this.abortController = new AbortController();
            let accumulatedText = '';
            let toolProgressHtml = '';
            let firstToken = true;

            try {
                const resp = await fetch(HERMES_BASE + '/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: messages,
                        model: this.app.activeModel || this.app.activeProfile,
                        profile: this.app.activeProfile,
                        session_id: this.app.sessionManager.activeSessionId,
                    }),
                    signal: this.abortController.signal,
                });

                if (!resp.ok) {
                    const errText = await resp.text();
                    bubble.innerHTML = `<div class="error-banner">Error ${resp.status}: ${this._escapeHtml(errText)}<span class="close-error">✕</span></div>`;
                    this.app.setStatus(`Error: ${resp.status}`, 'error');
                    return;
                }

                if (!resp.body) {
                    bubble.innerHTML = '<div class="error-banner">No response body received<span class="close-error">✕</span></div>';
                    this.app.setStatus('Stream error', 'error');
                    return;
                }

                this.app.setStatus('Streaming...', 'ok');
                this.app.setConnectionStatus('online');

                const reader = resp.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // Keep incomplete last line in buffer

                    for (const line of lines) {
                        if (!line.trim()) continue;

                        // SSE format: "data: {...}"
                        if (line.startsWith('data: ')) {
                            const dataStr = line.slice(6).trim();

                            if (dataStr === '[DONE]') {
                                // Stream complete
                                break;
                            }

                            try {
                                const data = JSON.parse(dataStr);
                                this._handleSSEEvent(data, bubble, (text) => {
                                    if (firstToken) {
                                        bubble.innerHTML = '';
                                        firstToken = false;
                                    }
                                    accumulatedText += text;
                                    bubble.innerHTML = renderMarkdown(accumulatedText);
                                    this._scrollToBottom();
                                });
                            } catch (e) {
                                // Not valid JSON — might be a raw text line
                                console.debug('Non-JSON SSE line:', dataStr);
                            }
                        }
                    }
                }

                // Process any remaining buffer
                if (buffer.trim() && buffer.startsWith('data: ')) {
                    const dataStr = buffer.slice(6).trim();
                    if (dataStr !== '[DONE]') {
                        try {
                            const data = JSON.parse(dataStr);
                            this._handleSSEEvent(data, bubble, (text) => {
                                if (firstToken) {
                                    bubble.innerHTML = '';
                                    firstToken = false;
                                }
                                accumulatedText += text;
                                bubble.innerHTML = renderMarkdown(accumulatedText);
                                this._scrollToBottom();
                            });
                        } catch (e) { /* ignore */ }
                    }
                }

                // Add streaming cursor while waiting, remove when done
                if (accumulatedText) {
                    bubble.innerHTML = renderMarkdown(accumulatedText);
                } else if (firstToken) {
                    bubble.innerHTML = '<span class="text-faint">(empty response)</span>';
                }

                // Store assistant response
                this.messages.push({ role: 'assistant', content: accumulatedText });

                this.app.setStatus('Ready', 'ok');

            } catch (e) {
                if (e.name === 'AbortError') {
                    this.app.setStatus('Stopped', 'ok');
                    if (accumulatedText) {
                        bubble.innerHTML = renderMarkdown(accumulatedText);
                    } else {
                        bubble.innerHTML = '<span class="text-faint">(stopped)</span>';
                    }
                } else {
                    console.error('Stream error:', e);
                    bubble.innerHTML = `<div class="error-banner">Stream error: ${this._escapeHtml(e.message)}<span class="close-error">✕</span></div>`;
                    this.app.setStatus('Stream error', 'error');
                }
            } finally {
                this.isStreaming = false;
                this._setStreamingUI(false);
                this.abortController = null;
            }
        }

        /**
         * Handle a single SSE event from the Hermes API.
         */
        _handleSSEEvent(data, bubble, appendText) {
            // Standard OpenAI chat.completion.chunk
            if (data.choices && data.choices[0]) {
                const delta = data.choices[0].delta;
                if (delta && delta.content) {
                    appendText(delta.content);
                }
                return;
            }

            // Hermes tool.progress event
            if (data.event === 'hermes.tool.progress' || data.type === 'tool.progress') {
                this._renderToolProgress(bubble, data);
                return;
            }

            // Hermes tool complete event
            if (data.event === 'hermes.tool.complete' || data.type === 'tool.complete') {
                this._renderToolComplete(bubble, data);
                return;
            }

            // Hermes error event
            if (data.error) {
                appendText(`\n\n**Error:** ${data.error}\n`);
                return;
            }

            // Generic content
            if (data.content) {
                appendText(data.content);
                return;
            }
        }

        /**
         * Render tool progress as an inline card.
         */
        _renderToolProgress(bubble, data) {
            const toolName = data.tool || data.name || 'unknown';
            const toolDetail = data.detail || data.args || data.input || '';
            const toolId = data.id || toolName;

            let html = `<div class="tool-progress" id="tool-${this._escapeHtml(toolId)}">`;
            html += `<span class="tool-icon">🔧</span>`;
            html += `<span class="tool-name">Running: ${this._escapeHtml(toolName)}</span>`;
            if (toolDetail) {
                html += `<div class="tool-detail">${this._escapeHtml(
                    typeof toolDetail === 'string' ? toolDetail : JSON.stringify(toolDetail, null, 2)
                )}</div>`;
            }
            html += `</div>`;

            // Append before the accumulated text
            const existing = bubble.querySelector('.tool-progress:last-of-type');
            const div = document.createElement('div');
            div.innerHTML = html;
            bubble.appendChild(div.firstChild);
            this._scrollToBottom();
        }

        _renderToolComplete(bubble, data) {
            const toolId = data.id || data.tool || data.name || '';
            const existing = document.getElementById(`tool-${this._escapeHtml(toolId)}`);
            if (existing) {
                existing.classList.add('completed');
                const nameEl = existing.querySelector('.tool-name');
                if (nameEl) nameEl.textContent = nameEl.textContent.replace('Running:', 'Done:');
            }
        }

        // ── UI Helpers ──────────────────────────────────────────────────

        displayMessage(role, content, animate = true) {
            const msgEl = this._createMessageElement(role);
            const bubble = msgEl.querySelector('.message-bubble');

            if (animate && role === 'assistant') {
                bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
            } else {
                bubble.innerHTML = renderMarkdown(content);
            }

            this._scrollToBottom();
            return msgEl;
        }

        _createMessageElement(role) {
            const messages = document.getElementById('messages');
            const msg = document.createElement('div');
            msg.className = `message ${role}`;

            const roleLabel = document.createElement('div');
            roleLabel.className = 'message-role';
            roleLabel.textContent = role;

            const bubble = document.createElement('div');
            bubble.className = 'message-bubble';

            msg.appendChild(roleLabel);
            msg.appendChild(bubble);
            messages.appendChild(msg);

            return msg;
        }

        _scrollToBottom() {
            const messages = document.getElementById('messages');
            messages.scrollTop = messages.scrollHeight;
        }

        _setStreamingUI(streaming) {
            document.getElementById('send-btn').style.display = streaming ? 'none' : 'flex';
            document.getElementById('stop-btn').style.display = streaming ? 'flex' : 'none';
            document.getElementById('message-input').disabled = false; // Keep enabled for stop+type
        }

        stop() {
            if (this.abortController) {
                this.abortController.abort();
            }
        }

        _escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = String(text);
            return div.innerHTML;
        }

        clear() {
            this.messages = [];
            document.getElementById('messages').innerHTML = '';
        }
    }

    window.ChatManager = ChatManager;
})();