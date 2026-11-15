'use strict';
// Faltbereiche für Twig in smartVISU-Seiten – die HTML-Tags faltet VS Code selbst, das hier kommt dazu:
// {% block/if/for/macro/… %} … {% end… %} (mit {% else %}/{% elseif %} als eigene Abschnitte),
// mehrzeilige {# … #}-Kommentare und /** … */-Docblöcke, aufeinanderfolgende {% import %}-Zeilen
// und mehrzeilige {{ … }}-Ausdrücke (z.B. Widget-Aufrufe über mehrere Zeilen). Ohne VS-Code-Abhängigkeit.
// Ergebnis: [{ start, end, kind? }] mit Zeilennummern (0-basiert); kind: 'comment' | 'imports'

const { lineIndex, inRawBlock } = require('./twig');

// Tags, die mit {% end<name> %} geschlossen werden
const PAIRED = new Set(['block', 'if', 'for', 'macro', 'set', 'embed', 'filter', 'apply', 'autoescape',
    'spaceless', 'with', 'sandbox', 'cache', 'guard']);
// Zwischen-Tags: beenden den Abschnitt davor und beginnen einen neuen
const MIDDLE = { else: ['if', 'for'], elseif: ['if'] };

function foldingRanges(text) {
    if (!/\{[{%#]/.test(text)) return [];
    const lineOf = lineIndex(text);
    const out = [];
    const add = (start, end, kind) => { if (end > start) out.push(kind ? { start, end, kind } : { start, end }); };
    const stack = [];
    const importLines = [];
    const spans = [];   // Twig-Bereiche, damit /** */ darin nicht doppelt zählt

    const re = /\{([{%#])/g;
    let m;
    while ((m = re.exec(text))) {
        const kind = m[1];
        const close = text.indexOf(kind === '{' ? '}}' : kind + '}', m.index + 2);
        if (close < 0) break;
        re.lastIndex = close + 2;
        spans.push([m.index, close + 2]);
        const first = lineOf(m.index);
        const last = lineOf(close);
        if (kind === '#') { add(first, last, 'comment'); continue; }
        if (kind === '{') { add(first, last - 1); continue; }    // schließende Zeile bleibt sichtbar

        const body = text.slice(m.index + 2, close).replace(/^[-~]/, '').replace(/[-~]$/, '').trim();
        const tm = /^\w+/.exec(body);
        if (!tm) continue;
        const name = tm[0];
        const rest = body.slice(name.length).trim();
        if (name === 'import' || name === 'from') { importLines.push(first); continue; }
        if (name === 'verbatim' || name === 'raw') {
            // Inhalt ist kein Twig – bis zum end-Tag überspringen
            const endRe = new RegExp('\\{%[-~]?\\s*end' + name + '\\s*[-~]?%\\}', 'g');
            endRe.lastIndex = re.lastIndex;
            const e = endRe.exec(text);
            if (!e) break;
            add(first, lineOf(e.index) - 1);
            spans.push([re.lastIndex, e.index + e[0].length]);
            re.lastIndex = e.index + e[0].length;
            continue;
        }
        if (PAIRED.has(name)) {
            // Kurzformen ohne end-Tag: {% block title "Text" %}, {% set x = 1 %}
            if (name === 'block' && /^\w+\s+\S/.test(rest)) continue;
            if (name === 'set' && rest.includes('=')) continue;
            stack.push({ name, line: first });
            continue;
        }
        if (MIDDLE[name]) {
            const top = stack[stack.length - 1];
            if (top && MIDDLE[name].includes(top.name)) {
                add(top.line, first - 1);
                top.line = first;
            }
            continue;
        }
        if (name.startsWith('end')) {
            const i = stack.map(s => s.name).lastIndexOf(name.slice(3));
            if (i < 0) continue;            // end-Tag ohne Anfang: ignorieren
            const top = stack[i];
            stack.length = i;               // nicht geschlossene Tags dazwischen verwerfen
            add(top.line, first - 1);
        }
    }

    // aufeinanderfolgende {% import %}-Zeilen
    for (let i = 0; i < importLines.length;) {
        let j = i;
        while (j + 1 < importLines.length && importLines[j + 1] - importLines[j] <= 1) j++;
        add(importLines[i], importLines[j], 'imports');
        i = j + 1;
    }

    // /** … */-Docblöcke (Seitenkopf, eigene Widgets) – nicht in <script>/<style>/<!-- --> und nicht in Twig
    const db = /\/\*\*[\s\S]*?\*\//g;
    while ((m = db.exec(text))) {
        const at = m.index;
        if (spans.some(([s, e]) => s <= at && at < e) || inRawBlock(text, at)) continue;
        add(lineOf(at), lineOf(at + m[0].length - 1), 'comment');
    }

    return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

module.exports = { foldingRanges };
