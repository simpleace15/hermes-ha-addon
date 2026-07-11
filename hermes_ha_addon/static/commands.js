/**
 * commands.js — Slash command parsing and autocomplete.
 */
(function () {
    'use strict';

    const COMMANDS = [
        { name: '/new', desc: 'Start a new session', action: 'local' },
        { name: '/skills', desc: 'List installed skills', action: 'passthrough' },
        { name: '/cron', desc: 'Show cron jobs', action: 'passthrough' },
        { name: '/profile', desc: 'Switch profile', action: 'local' },
        { name: '/help', desc: 'Show help', action: 'local' },
        { name: '/sessions', desc: 'List recent sessions', action: 'local' },
        { name: '/capabilities', desc: 'Show profile capabilities', action: 'passthrough' },
        { name: '/clear', desc: 'Clear chat display', action: 'local' },
    ];

    /**
     * Parse a message for slash commands.
     * Returns { isCommand, command, args, passthrough } or null.
     */
    function parse(text) {
        const trimmed = text.trim();
        if (!trimmed.startsWith('/')) return null;

        const spaceIdx = trimmed.indexOf(' ');
        const cmdName = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
        const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
        const command = COMMANDS.find(c => c.name === cmdName);

        if (!command) {
            // Unknown command — pass through to the agent
            return { isCommand: true, command: null, cmdName, args, passthrough: true, raw: trimmed };
        }

        return {
            isCommand: true,
            command,
            cmdName: command.name,
            args,
            passthrough: command.action === 'passthrough',
            raw: trimmed,
        };
    }

    /**
     * Handle a local command (not sent to the agent).
     * Returns true if handled, false if should be sent as a message.
     */
    function handleLocal(parsed, app) {
        if (!parsed || !parsed.command) return false;

        switch (parsed.command.name) {
            case '/new':
                app.newSession();
                return true;

            case '/profile':
                app.showProfileSelector();
                return true;

            case '/help':
                app.showHelp();
                return true;

            case '/sessions':
                app.showSessionList();
                return true;

            case '/clear':
                app.clearChat();
                return true;

            default:
                return false;
        }
    }

    /**
     * Filter commands for autocomplete based on typed prefix.
     */
    function filter(prefix) {
        if (!prefix.startsWith('/')) return [];
        return COMMANDS.filter(c =>
            c.name.startsWith(prefix) || c.name.startsWith(prefix.toLowerCase())
        );
    }

    /**
     * Render the command dropdown.
     */
    function renderDropdown(commands, selectedIndex) {
        const dropdown = document.getElementById('command-dropdown');
        if (commands.length === 0) {
            dropdown.style.display = 'none';
            return;
        }

        let html = '';
        commands.forEach((cmd, i) => {
            const selected = i === selectedIndex ? 'selected' : '';
            html += `<div class="command-item ${selected}" data-cmd="${cmd.name}">`;
            html += `<span class="cmd-name">${cmd.name}</span>`;
            html += `<span class="cmd-desc">${cmd.desc}</span>`;
            html += '</div>';
        });
        dropdown.innerHTML = html;
        dropdown.style.display = 'block';
    }

    // Expose globally
    window.SlashCommands = {
        COMMANDS,
        parse,
        handleLocal,
        filter,
        renderDropdown,
    };
})();