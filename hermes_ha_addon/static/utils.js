/**
 * utils.js — Shared utility functions used across all modules.
 * Loaded first (after theme inline script, before all other JS).
 */
(function () {
    'use strict';

    /**
     * Escape text for safe HTML insertion (prevents XSS).
     * @param {string} text
     * @returns {string} HTML-escaped text
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    /**
     * Escape text for safe use inside an HTML attribute value.
     * @param {string} text
     * @returns {string}
     */
    function escapeAttr(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    /**
     * Truncate text to maxLen, appending "..." if truncated.
     */
    function truncate(text, maxLen) {
        if (text.length <= maxLen) return text;
        return text.substring(0, maxLen) + '...';
    }

    /**
     * Fetch with a timeout. Returns a promise that rejects after timeoutMs.
     * @param {string} url
     * @param {Object} options — standard fetch options + timeoutMs (default 30000)
     * @returns {Promise<Response>}
     */
    function fetchWithTimeout(url, options = {}) {
        const timeoutMs = options.timeoutMs || 30000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        // Don't override caller's signal — use our controller
        const fetchOpts = { ...options, signal: controller.signal };
        delete fetchOpts.timeoutMs;

        return fetch(url, fetchOpts).finally(() => clearTimeout(timeoutId));
    }

    window.HermesUtils = { escapeHtml, escapeAttr, truncate, fetchWithTimeout };
})();