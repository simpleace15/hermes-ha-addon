/**
 * themes.js — Theme system with 4 built-in themes.
 * Themes are applied by setting a data-theme attribute on <html>.
 * The user's choice is persisted in localStorage and can be overridden
 * by the HA add-on config (theme option).
 */
(function () {
    'use strict';

    const THEMES = [
        { id: 'ha-dark',     name: 'HA Dark',         icon: '🌙' },
        { id: 'ha-light',    name: 'HA Light',        icon: '☀️' },
        { id: 'midnight',    name: 'Midnight Purple', icon: '🌌' },
        { id: 'solarized',   name: 'Solarized',       icon: '🌴' },
    ];

    const DEFAULT_THEME = 'ha-dark';

    function getStoredTheme() {
        return localStorage.getItem('hermes_theme') || DEFAULT_THEME;
    }

    function setStoredTheme(themeId) {
        localStorage.setItem('hermes_theme', themeId);
    }

    function applyTheme(themeId) {
        // Validate theme exists
        const valid = THEMES.find(t => t.id === themeId);
        const theme = valid ? themeId : DEFAULT_THEME;

        document.documentElement.setAttribute('data-theme', theme);
        setStoredTheme(theme);

        // Update the selector dropdown
        const selector = document.getElementById('theme-selector');
        if (selector) selector.value = theme;

        // Update the theme icon
        const iconEl = document.getElementById('theme-icon');
        if (iconEl) {
            const t = THEMES.find(x => x.id === theme);
            iconEl.textContent = t ? t.icon : '🎨';
        }

        console.log('Theme applied:', theme);
    }

    function initTheme() {
        // Check if backend has a configured theme (from HA options)
        // Falls back to localStorage if no server config or fetch fails
        let applied = false;

        fetch(HERMES_BASE + '/api/theme')
            .then(resp => resp.json())
            .then(data => {
                if (data.theme && data.theme !== 'ha-dark') {
                    // Server has a non-default theme — use it
                    applyTheme(data.theme);
                    applied = true;
                }
            })
            .catch(() => { /* ignore — use localStorage */ })
            .finally(() => {
                if (!applied) {
                    applyTheme(getStoredTheme());
                }
            });

        // Bind selector change
        const selector = document.getElementById('theme-selector');
        if (selector) {
            selector.addEventListener('change', (e) => {
                applyTheme(e.target.value);
            });
        }

        // Make theme icon clickable — cycles through themes
        const iconEl = document.getElementById('theme-icon');
        if (iconEl) {
            iconEl.style.cursor = 'pointer';
            iconEl.title = 'Click to cycle themes';
            iconEl.addEventListener('click', () => {
                const current = getStoredTheme();
                const idx = THEMES.findIndex(t => t.id === current);
                const next = THEMES[(idx + 1) % THEMES.length];
                applyTheme(next.id);
            });
        }
    }

    // Expose for app.js to call after DOM ready
    window.HermesThemes = {
        THEMES,
        applyTheme,
        initTheme,
        getStoredTheme,
    };
})();