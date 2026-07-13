/**
 * chat.js — Chat send/receive, SSE streaming, message rendering.
 *
 * Uses fetch() with ReadableStream for SSE (not EventSource, because
 * EventSource only supports GET and we need POST).
 *
 * Hermes SSE format:
 *   data: {"choices": [{"delta": {"content": "..."}}]}     — OpenAI chunks
 *   event: hermes.tool.progress                              — named events
 *   data: {"tool": "execute_code", "status": "running", ...}
 *   event: hermes.tool.complete
 *   data: {"toolCallId": "call_abc", ...}
 */
(function () {
    'use strict';

    const MAX_RETRIES = 2;

    class ChatManager {
        constructor(app) {
            this.app = app;
            this.isStreaming = false;
            this.abortController = null;
            this.currentStream = null;
            this.retryCount = 0;

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

            // Message history — Up/Down arrow to recall previous messages
            this._messageHistory = [];
            this._historyIndex = -1;
            input.addEventListener('keydown', (e) => {
                if (this._commandState && this._commandState.visible) return;
                if (e.key === 'ArrowUp' && input.value === '') {
                    // Recall previous message
                    if (this._messageHistory.length > 0) {
                        this._historyIndex = Math.min(this._historyIndex + 1, this._messageHistory.length - 1);
                        input.value = this._messageHistory[this._messageHistory.length - 1 - this._historyIndex];
                        // Place cursor at end
                        input.setSelectionRange(input.value.length, input.value.length);
                        e.preventDefault();
                    }
                } else if (e.key === 'ArrowDown' && this._historyIndex >= 0) {
                    this._historyIndex--;
                    if (this._historyIndex < 0) {
                        input.value = '';
                    } else {
                        input.value = this._messageHistory[this._messageHistory.length - 1 - this._historyIndex];
                    }
                    input.setSelectionRange(input.value.length, input.value.length);
                    e.preventDefault();
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

            // Markdown preview toggle
            this._previewMode = false;
            const previewBtn = document.getElementById('preview-btn');
            if (previewBtn) {
                previewBtn.addEventListener('click', () => this._togglePreview());
            }

            // Image paste support
            this._pendingImages = [];
            input.addEventListener('paste', (e) => {
                const items = e.clipboardData?.items;
                if (!items) return;
                for (const item of items) {
                    if (item.type.startsWith('image/')) {
                        const file = item.getAsFile();
                        if (file) this._handleImageFile(file);
                    }
                }
            });

            // Drag-drop image support
            const dropZone = document.getElementById('message-input');
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.style.border = '2px dashed var(--primary)';
            });
            dropZone.addEventListener('dragleave', () => {
                dropZone.style.border = '';
            });
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.style.border = '';
                const files = e.dataTransfer?.files;
                if (!files) return;
                for (const file of files) {
                    if (file.type.startsWith('image/')) {
                        this._handleImageFile(file);
                    }
                }
            });
        }

        // ── Markdown Preview Toggle ─────────────────────────────────────

        _togglePreview() {
            const input = document.getElementById('message-input');
            this._previewMode = !this._previewMode;
            if (this._previewMode) {
                // Show preview
                const text = input.value.trim();
                if (!text) return;
                input.style.display = 'none';
                let preview = document.getElementById('input-preview');
                if (!preview) {
                    preview = document.createElement('div');
                    preview.id = 'input-preview';
                    preview.className = 'input-preview message-bubble';
                    preview.style.maxHeight = '200px';
                    preview.style.overflowY = 'auto';
                    input.parentNode.insertBefore(preview, input);
                }
                preview.innerHTML = renderMarkdown(text);
                preview.style.display = 'block';
            } else {
                // Back to edit mode
                input.style.display = '';
                const preview = document.getElementById('input-preview');
                if (preview) preview.style.display = 'none';
            }
        }

        _handleImageFile(file) {
            if (file.size > 10 * 1024 * 1024) {
                this.app.setStatus('Image too large (max 10MB)', 'error');
                return;
            }
            const reader = new FileReader();
            reader.onload = (e) => {
                this._pendingImages.push({
                    data: e.target.result,  // data:image/png;base64,...
                    type: file.type,
                    name: file.name || 'pasted-image',
                });
                this._renderImagePreview();
            };
            reader.readAsDataURL(file);
        }

        _renderImagePreview() {
            let preview = document.getElementById('image-preview');
            if (!preview) {
                preview = document.createElement('div');
                preview.id = 'image-preview';
                preview.className = 'image-preview';
                const inputArea = document.querySelector('.chat-input-area');
                inputArea.insertBefore(preview, inputArea.firstChild);
            }
            if (this._pendingImages.length === 0) {
                preview.innerHTML = '';
                preview.style.display = 'none';
                return;
            }
            preview.style.display = 'flex';
            preview.innerHTML = this._pendingImages.map((img, i) =>
                `<div class="image-preview-item"><img src="${img.data}" alt="${img.name}"><button class="image-remove" data-idx="${i}">✕</button></div>`
            ).join('');
            // Bind remove buttons
            preview.querySelectorAll('.image-remove').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const idx = parseInt(e.target.dataset.idx);
                    this._pendingImages.splice(idx, 1);
                    this._renderImagePreview();
                });
            });
        }

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

            // Exit preview mode if active
            if (this._previewMode) {
                this._togglePreview();
            }

            // Store in message history
            if (this._messageHistory.length === 0 || this._messageHistory[this._messageHistory.length - 1] !== text) {
                this._messageHistory.push(text);
                if (this._messageHistory.length > 50) this._messageHistory.shift();
            }
            this._historyIndex = -1;

            // Build messages array for API
            const msgContent = parsed && parsed.isCommand ? parsed.raw : text;
            // If we have pending images, send as OpenAI vision format (content array)
            if (this._pendingImages.length > 0) {
                const content = [{ type: 'text', text: msgContent }];
                this._pendingImages.forEach(img => {
                    content.push({
                        type: 'image_url',
                        image_url: { url: img.data },
                    });
                });
                this.messages.push({ role: 'user', content });
                this._pendingImages = [];
                this._renderImagePreview();
            } else {
                this.messages.push({ role: 'user', content: msgContent });
            }

            // Reset retry count on new message
            this.retryCount = 0;
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
            let firstToken = true;
            const startTime = Date.now();
            this._capturedUsage = null;
            this._capturedModel = '';

            try {
                const resp = await fetch(HERMES_BASE + '/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: messages,
                        model: this.app.activeModel || this.app.activeProfile,
                        profile: this.app.activeProfile,
                        session_id: this.app.sessionManager.activeSessionId,
                        stream_options: { include_usage: true },
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

                const result = await this._processSSEStream(resp.body, bubble, accumulatedText, firstToken);
                accumulatedText = result.accumulatedText;
                firstToken = result.firstToken;
                const usage = result.usage;
                const responseModel = result.model;
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

                console.log('[hermes] Stream done: usage=', usage, 'model=', responseModel, 'elapsed=', elapsed);

                // Finalize
                if (accumulatedText) {
                    bubble.innerHTML = renderMarkdown(accumulatedText);
                    this._addCopyButtons(bubble);
                } else if (firstToken) {
                    bubble.innerHTML = '<span class="text-faint">(empty response)</span>';
                }

                // Add token/usage metadata bar
                if (usage || elapsed > 0) {
                    this._addUsageMetadata(msgEl, usage, responseModel, elapsed);
                }

                // Browser notification if tab not focused
                this._notifyOnComplete(accumulatedText);

                // Store assistant response
                this.messages.push({ role: 'assistant', content: accumulatedText });

                this.app.setStatus('Ready', 'ok');

            } catch (e) {
                if (e.name === 'AbortError') {
                    this.app.setStatus('Stopped', 'ok');
                    if (accumulatedText) {
                        bubble.innerHTML = renderMarkdown(accumulatedText);
                        this._addCopyButtons(bubble);
                    } else {
                        bubble.innerHTML = '<span class="text-faint">(stopped)</span>';
                    }
                } else {
                    console.error('Stream error:', e);
                    // Auto-reconnect on network errors
                    if (this.retryCount < MAX_RETRIES && !e.message.includes('40')) {
                        this.retryCount++;
                        const delay = 1000 * this.retryCount;
                        const countdown = Math.ceil(delay / 1000);
                        this.app.setStatus(`Reconnecting in ${countdown}s (${this.retryCount}/${MAX_RETRIES})...`, 'connecting');
                        bubble.innerHTML = `<div class="reconnect-banner">Connection lost. Retrying in ${countdown}s... (${this.retryCount}/${MAX_RETRIES})</div>`;
                        await new Promise(r => setTimeout(r, delay));
                        // Retry with same messages
                        this.isStreaming = false;
                        bubble.remove();
                        await this._streamChat(messages);
                        return;
                    }
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
         * Process SSE stream — handles both named events and data-only events.
         * Returns { accumulatedText, firstToken }.
         */
        async _processSSEStream(body, bubble, accumulatedText, firstToken) {
            const reader = body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let currentEventType = '';  // Track named event type
            let usage = null;  // Token usage from final chunk
            let responseModel = '';  // Model name from response

            const appendText = (text) => {
                if (firstToken) {
                    bubble.innerHTML = '';
                    firstToken = false;
                }
                accumulatedText += text;
                bubble.innerHTML = renderMarkdown(accumulatedText);
                this._scrollToBottom();
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep incomplete last line in buffer

                for (const line of lines) {
                    const trimmed = line.trim();

                    // Empty line = SSE event boundary, reset event type
                    if (!trimmed) {
                        currentEventType = '';
                        continue;
                    }

                    // Named event line: "event: hermes.tool.progress"
                    if (trimmed.startsWith('event: ')) {
                        currentEventType = trimmed.slice(7).trim();
                        continue;
                    }

                    // Data line
                    if (trimmed.startsWith('data: ')) {
                        const dataStr = trimmed.slice(6).trim();

                        if (dataStr === '[DONE]') {
                            currentEventType = '';
                            continue;
                        }

                        try {
                            const data = JSON.parse(dataStr);

                            // If we have a named event type, use it
                            if (currentEventType) {
                                this._handleNamedEvent(currentEventType, data, bubble, appendText);
                            } else {
                                // Standard OpenAI chunk (no event type)
                                this._handleDataEvent(data, bubble, appendText);
                            }
                        } catch (e) {
                            // Not valid JSON — might be a raw text line
                            console.debug('Non-JSON SSE line:', dataStr);
                        }

                        // Reset event type after processing data
                        currentEventType = '';
                    }
                }
            }

            // Process any remaining buffer
            if (buffer.trim() && buffer.startsWith('data: ')) {
                const dataStr = buffer.slice(6).trim();
                if (dataStr !== '[DONE]') {
                    try {
                        const data = JSON.parse(dataStr);
                        if (currentEventType) {
                            this._handleNamedEvent(currentEventType, data, bubble, appendText);
                        } else {
                            this._handleDataEvent(data, bubble, appendText);
                        }
                    } catch (e) { /* ignore */ }
                }
            }

            return { accumulatedText, firstToken, usage: this._capturedUsage || null, model: this._capturedModel || '' };
        }

        /**
         * Handle a named SSE event (event: xxx).
         */
        _handleNamedEvent(eventType, data, bubble, appendText) {
            switch (eventType) {
                case 'hermes.tool.progress':
                case 'tool.progress':
                    this._renderToolProgress(bubble, data);
                    break;

                case 'hermes.tool.complete':
                case 'tool.complete':
                    this._renderToolComplete(bubble, data);
                    break;

                case 'hermes.approval.requested':
                case 'approval.requested':
                    this._renderApprovalDialog(bubble, data);
                    break;

                case 'hermes.approval.resolved':
                case 'approval.resolved':
                    this._renderApprovalResolved(bubble, data);
                    break;

                default:
                    // Unknown named event — check if it has content
                    if (data.delta) {
                        appendText(data.delta);
                    } else if (data.content) {
                        appendText(data.content);
                    }
                    console.debug('Unhandled SSE event:', eventType, data);
            }
        }

        /**
         * Handle a data-only SSE event (no event: line).
         */
        _handleDataEvent(data, bubble, appendText) {
            // Capture usage from final chunk (has usage, empty delta)
            if (data.usage) {
                this._capturedUsage = data.usage;
                console.log('[hermes] Captured usage:', data.usage);
            }
            if (data.model) {
                this._capturedModel = data.model;
            }

            // Standard OpenAI chat.completion.chunk
            if (data.choices && data.choices[0]) {
                const delta = data.choices[0].delta;
                if (delta && delta.content) {
                    appendText(delta.content);
                }
                return;
            }

            // Hermes tool.progress event (legacy — some endpoints embed it in data)
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

            // Run events (message.delta, run.completed, etc.)
            if (data.event === 'message.delta' && data.delta) {
                appendText(data.delta);
                return;
            }
            if (data.event === 'run.completed' && data.output) {
                appendText(data.output);
                if (data.usage) {
                    this._capturedUsage = data.usage;
                    console.log('[hermes] Captured usage from run.completed:', data.usage);
                }
                return;
            }
        }

        // ── Tool Progress Rendering ─────────────────────────────────────

        _renderToolProgress(bubble, data) {
            const toolName = data.tool || data.name || 'unknown';
            const toolLabel = data.label || data.detail || data.args || data.input || '';
            const toolEmoji = data.emoji || '🔧';
            const toolId = data.toolCallId || data.id || toolName;
            const status = data.status || 'running';

            if (status === 'completed') {
                this._markToolComplete(bubble, toolId);
                return;
            }

            let html = `<div class="tool-progress" id="tool-${this._escapeHtml(toolId)}">`;
            html += `<span class="tool-icon">${toolEmoji}</span>`;
            html += `<span class="tool-name">${this._escapeHtml(toolName)}</span>`;
            if (toolLabel) {
                // Truncate very long labels
                const displayLabel = toolLabel.length > 200
                    ? toolLabel.substring(0, 200) + '...'
                    : toolLabel;
                html += `<div class="tool-detail">${this._escapeHtml(displayLabel)}</div>`;
            }
            html += '</div>';

            // Insert before accumulated text
            const div = document.createElement('div');
            div.innerHTML = html;
            bubble.appendChild(div.firstChild);
            this._scrollToBottom();
        }

        _renderToolComplete(bubble, data) {
            const toolId = data.toolCallId || data.id || data.tool || data.name || '';
            this._markToolComplete(bubble, toolId);
        }

        _markToolComplete(bubble, toolId) {
            const existing = bubble.querySelector(`#tool-${CSS.escape(toolId)}`);
            if (existing) {
                existing.classList.add('completed');
                const nameEl = existing.querySelector('.tool-name');
                if (nameEl && !nameEl.textContent.includes('✓')) {
                    nameEl.textContent = '✓ ' + nameEl.textContent;
                }
            }
        }

        // ── Approval Dialog ──────────────────────────────────────────────

        _renderApprovalDialog(bubble, data) {
            const toolName = data.tool || data.name || 'unknown';
            const command = data.command || data.args || data.detail || '';
            const approvalId = data.approval_id || data.id || data.toolCallId || '';
            const reason = data.reason || data.message || '';

            let html = `<div class="approval-dialog" id="approval-${this._escapeHtml(approvalId)}">`;
            html += '<div class="approval-header">';
            html += '<span class="approval-icon">⚠️</span>';
            html += `<span class="approval-title">Approval needed: ${this._escapeHtml(toolName)}</span>`;
            html += '</div>';
            if (command) {
                html += `<div class="approval-command">${this._escapeHtml(command)}</div>`;
            }
            if (reason) {
                html += `<div class="approval-reason">${this._escapeHtml(reason)}</div>`;
            }
            html += '<div class="approval-buttons">';
            html += `<button class="btn btn-primary approval-approve" data-approval-id="${this._escapeHtml(approvalId)}">✓ Approve</button>`;
            html += `<button class="btn btn-danger approval-deny" data-approval-id="${this._escapeHtml(approvalId)}">✕ Deny</button>`;
            html += '</div>';
            html += '</div>';

            const div = document.createElement('div');
            div.innerHTML = html;
            const approvalEl = div.firstChild;
            bubble.appendChild(approvalEl);
            this._scrollToBottom();

            // Bind approve/deny buttons
            approvalEl.querySelector('.approval-approve').addEventListener('click', () => {
                this._sendApproval(approvalId, true);
            });
            approvalEl.querySelector('.approval-deny').addEventListener('click', () => {
                this._sendApproval(approvalId, false);
            });
        }

        _renderApprovalResolved(bubble, data) {
            const approvalId = data.approval_id || data.id || '';
            const approved = data.approved || data.resolution === 'approved';
            const el = bubble.querySelector(`#approval-${CSS.escape(approvalId)}`);
            if (el) {
                el.classList.add(approved ? 'approved' : 'denied');
                const buttons = el.querySelector('.approval-buttons');
                if (buttons) buttons.remove();
                const header = el.querySelector('.approval-title');
                if (header) {
                    header.textContent = approved ? '✓ Approved' : '✕ Denied';
                }
            }
        }

        async _sendApproval(approvalId, approved) {
            try {
                const profile = this.app.activeProfile;
                const port = this.app.sessionManager.activeSessionId;
                const resp = await fetch(HERMES_BASE + '/api/approval', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        approval_id: approvalId,
                        approved: approved,
                        profile: profile,
                        session_id: this.app.sessionManager.activeSessionId,
                    }),
                });
                if (!resp.ok) {
                    console.error('Approval send failed:', resp.status);
                }
            } catch (e) {
                console.error('Approval error:', e);
            }
        }

        // ── Copy Buttons ─────────────────────────────────────────────────

        _addCopyButtons(bubble) {
            const codeBlocks = bubble.querySelectorAll('pre');
            codeBlocks.forEach(pre => {
                if (pre.querySelector('.copy-btn')) return; // Already has button
                const btn = document.createElement('button');
                btn.className = 'copy-btn';
                btn.textContent = 'Copy';
                btn.addEventListener('click', () => {
                    const code = pre.querySelector('code');
                    const text = code ? code.textContent : pre.textContent;
                    navigator.clipboard.writeText(text).then(() => {
                        btn.textContent = '✓ Copied!';
                        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
                    }).catch(() => {
                        btn.textContent = '✗ Failed';
                        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
                    });
                });
                pre.appendChild(btn);
            });
        }

        // ── Browser Notifications ─────────────────────────────────────────

        _notifyOnComplete(text) {
            if (document.hasFocus()) return;  // Only notify if tab not focused
            const preview = HermesUtils.truncate(text.replace(/[#*`]/g, '').trim(), 100);
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Hermes Agent', {
                    body: preview || 'Response complete',
                    icon: HERMES_BASE + '/icon.svg',
                });
            }
            // Also flash the favicon/title as fallback
            if (!document.hasFocus()) {
                const origTitle = document.title;
                document.title = '● Hermes Agent — Response ready';
                const onFocus = () => {
                    document.title = origTitle;
                    document.removeEventListener('focus', onFocus);
                };
                document.addEventListener('focus', onFocus);
            }
        }

        requestNotificationPermission() {
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }
        }

        // ── Usage Metadata ───────────────────────────────────────────────

        _addUsageMetadata(msgEl, usage, model, elapsed) {
            // Remove any existing metadata bar
            const existing = msgEl.querySelector('.message-meta');
            if (existing) existing.remove();

            const meta = document.createElement('div');
            meta.className = 'message-meta';

            const parts = [];

            // Model name
            if (model) {
                parts.push(`<span class="meta-item meta-model">🤖 ${this._escapeHtml(model)}</span>`);
            }

            // Token counts
            if (usage) {
                const prompt = usage.prompt_tokens || usage.input_tokens || 0;
                const completion = usage.completion_tokens || usage.output_tokens || 0;
                const total = usage.total_tokens || (prompt + completion);
                parts.push(`<span class="meta-item meta-tokens">📊 ${prompt}↑ ${completion}↓ ${total} total</span>`);
            }

            // Response time
            if (elapsed && elapsed > 0) {
                parts.push(`<span class="meta-item meta-time">⏱ ${elapsed}s</span>`);
            }

            meta.innerHTML = parts.join('');
            msgEl.appendChild(meta);
        }

        // ── UI Helpers ──────────────────────────────────────────────────

        displayMessage(role, content, animate = true) {
            const msgEl = this._createMessageElement(role);
            const bubble = msgEl.querySelector('.message-bubble');

            if (animate && role === 'assistant') {
                bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
            } else {
                bubble.innerHTML = renderMarkdown(content);
                if (role === 'assistant') {
                    this._addCopyButtons(bubble);
                }
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
            // Show profile name for assistant messages, "You" for user messages
            if (role === 'assistant') {
                roleLabel.textContent = this.app.activeProfile || 'assistant';
            } else {
                roleLabel.textContent = role === 'user' ? 'You' : role;
            }

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
            document.getElementById('message-input').disabled = false;
        }

        stop() {
            if (this.abortController) {
                this.abortController.abort();
            }
        }

        _escapeHtml(text) {
            return HermesUtils.escapeHtml(text);
        }

        clear() {
            this.messages = [];
            document.getElementById('messages').innerHTML = '';
        }
    }

    window.ChatManager = ChatManager;
})();