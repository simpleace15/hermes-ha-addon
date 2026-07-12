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

    // ── Lightweight syntax highlighting ──────────────────────────────
    // Adds basic coloring for keywords, strings, comments, and numbers.
    // No external deps — works inside HA Ingress (no CDN access needed).

    const HIGHLIGHT_LANGS = {
        python: { keywords: /\b(def|class|if|elif|else|for|while|try|except|finally|with|as|import|from|return|yield|raise|lambda|None|True|False|and|or|not|in|is|pass|break|continue|global|nonlocal|assert|del|async|await)\b/g, comments: /#[^\n]*/g, strings: true },
        javascript: { keywords: /\b(function|const|let|var|if|else|for|while|return|class|extends|new|this|async|await|try|catch|finally|throw|typeof|instanceof|true|false|null|undefined|void|delete|break|continue|switch|case|default|do|in|of|yield)\b/g, comments: /\/\/[^\n]*/g, strings: true },
        typescript: { keywords: /\b(function|const|let|var|if|else|for|while|return|class|extends|new|this|async|await|try|catch|finally|throw|typeof|instanceof|true|false|null|undefined|void|delete|break|continue|switch|case|default|do|in|of|yield|interface|type|enum|implements|private|public|protected|readonly|as|is)\b/g, comments: /\/\/[^\n]*/g, strings: true },
        bash: { keywords: /\b(if|then|else|fi|for|while|do|done|case|esac|function|return|local|export|echo|exit|source|cd|ls|cat|grep|sed|awk|curl|wget|sudo|bash|sh)\b/g, comments: /#[^\n]*/g, strings: true },
        shell: { keywords: /\b(if|then|else|fi|for|while|do|done|case|esac|function|return|local|export|echo|exit|source|cd|ls|cat|grep|sed|awk|curl|wget|sudo|bash|sh)\b/g, comments: /#[^\n]*/g, strings: true },
        yaml: { keywords: /\b(true|false|null|yes|no)\b/g, comments: /#[^\n]*/g, strings: false },
        json: { keywords: /\b(true|false|null)\b/g, comments: null, strings: true },
        sql: { keywords: /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|CREATE|TABLE|ALTER|DROP|INDEX|PRIMARY|KEY|FOREIGN|REFERENCES|NOT|NULL|DEFAULT|UNIQUE|AND|OR|IN|EXISTS|BETWEEN|LIKE|AS|DISTINCT|UNION|ALL|CASE|WHEN|THEN|ELSE|END)\b/gi, comments: /--[^\n]*/g, strings: true },
        html: { keywords: null, comments: null, strings: false },
        css: { keywords: /\b(important|inherit|initial|unset)\b/g, comments: /\/\*[^]*?\*\//g, strings: false },
        dockerfile: { keywords: /\b(FROM|RUN|COPY|ADD|CMD|ENTRYPOINT|ENV|ARG|WORKDIR|EXPOSE|LABEL|VOLUME|USER|HEALTHCHECK)\b/g, comments: /#[^\n]*/g, strings: true },
        go: { keywords: /\b(func|package|import|var|const|type|struct|interface|if|else|for|range|switch|case|default|return|go|defer|chan|select|break|continue|true|false|nil)\b/g, comments: /\/\/[^\n]*/g, strings: true },
        rust: { keywords: /\b(fn|let|mut|const|struct|enum|impl|trait|pub|use|mod|if|else|match|for|while|loop|return|break|continue|as|in|ref|move|self|Self|true|false)\b/g, comments: /\/\/[^\n]*/g, strings: true },
    };

    // Alias mappings
    const LANG_ALIASES = { py: 'python', js: 'javascript', ts: 'typescript', sh: 'bash', yml: 'yaml', dockerfile: 'dockerfile', docker: 'dockerfile' };

    function highlightCode(code, lang) {
        const resolved = LANG_ALIASES[lang] || lang;
        const config = HIGHLIGHT_LANGS[resolved];
        if (!config) return escapeHtml(code);

        // Escape first, then apply highlighting via replacement
        let html = escapeHtml(code);

        // Highlight strings (do this first to avoid keyword matches inside strings)
        if (config.strings) {
            // Double-quoted strings
            html = html.replace(/"([^"\\]|\\.)*"/g, '<span class="hl-string">$&</span>');
            // Single-quoted strings
            html = html.replace(/'([^'\\]|\\.)*'/g, '<span class="hl-string">$&</span>');
            // Template literals (backtick) — simple version
            html = html.replace(/`([^`\\]|\\.)*`/g, '<span class="hl-string">$&</span>');
        }

        // Highlight comments
        if (config.comments) {
            html = html.replace(config.comments, '<span class="hl-comment">$&</span>');
        }

        // Highlight keywords
        if (config.keywords) {
            html = html.replace(config.keywords, '<span class="hl-keyword">$&</span>');
        }

        // Highlight numbers (standalone)
        html = html.replace(/\b(\d+\.?\d*)\b/g, function(match, _p1, offset, full) {
            // Don't highlight numbers inside spans
            if (offset > 0) {
                const before = full.substring(0, offset);
                const lastOpen = before.lastIndexOf('<span');
                const lastClose = before.lastIndexOf('</span>');
                if (lastOpen > lastClose) return match; // Inside a span
            }
            return '<span class="hl-number">' + match + '</span>';
        });

        return html;
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
                    html.push(`<pre><code class="lang-${codeLang}">${highlightCode(code, codeLang)}</code></pre>`);
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