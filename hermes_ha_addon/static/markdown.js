/**
 * markdown.js — Lightweight markdown renderer.
 * No dependencies, no build step. Handles the common subset:
 * headers, bold, italic, code (inline + block), lists, links, tables, blockquotes, hr.
 */
(function () {
    'use strict';

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function renderInline(text) {
        let html = escapeHtml(text);

        // Inline code: `code` (do this first to avoid interpreting inside)
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Bold: **text**
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // Italic: *text* (but not **)
        html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');

        // Strikethrough: ~~text~~
        html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

        // Links: [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener">$1</a>');

        // Images: ![alt](url)
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
            '<img src="$2" alt="$1" style="max-width:100%;border-radius:6px;">');

        return html;
    }

    function renderMarkdown(md) {
        if (!md) return '';

        const lines = md.split('\n');
        const html = [];
        let inCodeBlock = false;
        let codeLang = '';
        let codeLines = [];
        let inList = false;
        let listType = 'ul'; // 'ul' or 'ol'
        let inTable = false;
        let tableRows = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Code block fence
            if (line.trim().startsWith('```')) {
                if (!inCodeBlock) {
                    inCodeBlock = true;
                    codeLang = line.trim().slice(3).trim();
                    codeLines = [];
                } else {
                    // Close code block
                    const code = codeLines.join('\n');
                    html.push(`<pre><code class="lang-${codeLang}">${escapeHtml(code)}</code></pre>`);
                    inCodeBlock = false;
                    codeLang = '';
                    codeLines = [];
                }
                continue;
            }

            if (inCodeBlock) {
                codeLines.push(line);
                continue;
            }

            // Table detection: line with | and next line with |---|
            if (line.includes('|') && !inTable) {
                const nextLine = lines[i + 1] || '';
                if (/^\|?[\s-]*-{3,}[\s-|]*$/.test(nextLine)) {
                    inTable = true;
                    tableRows = [];
                    // Parse header row
                    const cells = line.split('|').map(c => c.trim()).filter(c => c !== '' || true);
                    // Clean empty edges
                    if (cells[0] === '') cells.shift();
                    if (cells[cells.length - 1] === '') cells.pop();
                    tableRows.push(cells);
                    i++; // Skip separator line
                    continue;
                }
            }

            if (inTable) {
                if (line.includes('|')) {
                    const cells = line.split('|').map(c => c.trim());
                    if (cells[0] === '') cells.shift();
                    if (cells[cells.length - 1] === '') cells.pop();
                    tableRows.push(cells);
                } else {
                    // Render table
                    html.push(renderTable(tableRows));
                    inTable = false;
                    tableRows = [];
                    // Process this line normally
                }
                if (inTable) continue;
            }

            // Headers
            const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);
            if (headerMatch) {
                if (inList) { html.push(`</${listType}>`); inList = false; }
                const level = headerMatch[1].length;
                html.push(`<h${level}>${renderInline(headerMatch[2])}</h${level}>`);
                continue;
            }

            // Horizontal rule
            if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
                if (inList) { html.push(`</${listType}>`); inList = false; }
                html.push('<hr>');
                continue;
            }

            // Blockquote
            if (line.startsWith('> ')) {
                if (inList) { html.push(`</${listType}>`); inList = false; }
                html.push(`<blockquote>${renderInline(line.slice(2))}</blockquote>`);
                continue;
            }

            // Ordered list item
            const olMatch = line.match(/^\d+\.\s+(.+)$/);
            if (olMatch) {
                if (!inList || listType !== 'ol') {
                    if (inList) html.push(`</${listType}>`);
                    html.push('<ol>');
                    inList = true;
                    listType = 'ol';
                }
                html.push(`<li>${renderInline(olMatch[1])}</li>`);
                continue;
            }

            // Unordered list item
            const ulMatch = line.match(/^[-*]\s+(.+)$/);
            if (ulMatch) {
                if (!inList || listType !== 'ul') {
                    if (inList) html.push(`</${listType}>`);
                    html.push('<ul>');
                    inList = true;
                    listType = 'ul';
                }
                html.push(`<li>${renderInline(ulMatch[1])}</li>`);
                continue;
            }

            // Close list if we were in one
            if (inList && line.trim() === '') {
                html.push(`</${listType}>`);
                inList = false;
            }

            // Regular paragraph
            if (line.trim() === '') {
                if (inList) { html.push(`</${listType}>`); inList = false; }
                // Don't push empty <p> tags
            } else {
                if (inList) { html.push(`</${listType}>`); inList = false; }
                html.push(`<p>${renderInline(line)}</p>`);
            }
        }

        // Close any open blocks
        if (inCodeBlock) {
            html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        }
        if (inList) html.push(`</${listType}>`);
        if (inTable) html.push(renderTable(tableRows));

        return html.join('\n');
    }

    function renderTable(rows) {
        if (rows.length < 1) return '';
        const header = rows[0];
        const body = rows.slice(1);

        let html = '<table><thead><tr>';
        header.forEach(cell => { html += `<th>${renderInline(cell)}</th>`; });
        html += '</tr></thead><tbody>';
        body.forEach(row => {
            html += '<tr>';
            row.forEach(cell => { html += `<td>${renderInline(cell)}</td>`; });
            html += '</tr>';
        });
        html += '</tbody></table>';
        return html;
    }

    // Expose globally
    window.renderMarkdown = renderMarkdown;
})();