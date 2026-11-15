'use strict';
// Reihenfolge der Item-Vorschläge, ID-Vorschläge und Snippets für Widget-Aufrufe. Ohne VS-Code-Abhängigkeit.

const { parentOf, lastSeg, pathsOf, isItemParam } = require('./learn');

// Wörter im Dateinamen, die nichts über den Raum aussagen
const GENERIC_FILE = new Set(['rooms', 'room', 'zentral', 'index', 'page', 'pages', 'html', 'category', 'navigation', 'menu']);
// Item-Endungen, die in einer ID nichts aussagen
const GENERIC_SEG = new Set(['schalten', 'dimmen', 'status', 'wert', 'value', 'switch', 'dim', 'level', 'onoff', 'state', 'aktiv', 'sa', 'uzsu']);

function splitWords(s) {
    return String(s)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9äöüß]+/)
        .filter(Boolean);
}

/** Raum-Wörter aus dem Dateinamen: "rooms.eg.bad.html" -> Set(eg, bad) */
function fileTokens(fileName) {
    const base = String(fileName).split(/[\\/]/).pop().replace(/\.html?$/i, '');
    return new Set(splitWords(base).filter(w => !GENERIC_FILE.has(w)));
}

function commonPrefix(a, b) {
    const x = a.split('.'), y = b.split('.');
    let n = 0;
    while (n < x.length && n < y.length && x[n] === y[n]) n++;
    return n;
}

/**
 * Items für einen Item-Parameter sortieren.
 * @param items   [{ path, type, name }]
 * @param ctx     { widget, param, argIndex, call (twig-Aufruf), stats, tokens: Set, near: [{ path, dist }] }
 * @returns [{ item, score, typeOk }] absteigend
 */
function rankItems(items, ctx) {
    const { widget, param, argIndex, stats, tokens } = ctx;
    const valid = (param && param.type === 'item' && param.valid) || [];
    const key = widget ? `${widget.name}#${argIndex}` : '';
    const segs = stats && stats.lastSegs.get(key);
    let segMax = 0;
    if (segs) for (const v of segs.values()) segMax = Math.max(segMax, v);

    // andere Item-Parameter desselben Aufrufs, die schon ausgefüllt sind
    const others = [];
    if (widget && ctx.call) {
        ctx.call.args.forEach((a, i) => {
            if (i === argIndex || !isItemParam(widget.params[i])) return;
            for (const p of pathsOf(a)) {
                const sib = stats && stats.siblings.get(`${widget.name}#${argIndex}#${i}`);
                others.push({ path: p, parent: parentOf(p), weight: sib && sib.total ? 0.2 + 0.8 * sib.same / sib.total : 0.6 });
            }
        });
    }
    const near = ctx.near || [];

    const out = [];
    for (const item of items) {
        const t = item.type;
        let score = 0.2;
        let typeOk = true;
        if (valid.length) {
            if (valid.includes(t)) score += 0.35;
            else if (!t || t === 'foo') { score -= 0.3; typeOk = false; }
            else { score -= 0.12; typeOk = false; }
        } else if (!t || t === 'foo') score -= 0.15;

        if (segMax) score += 0.35 * Math.sqrt((segs.get(lastSeg(item.path)) || 0) / segMax);

        for (const o of others) {
            if (o.path === item.path) score -= 0.1;
            else if (parentOf(item.path) === o.parent) score += 0.45 * o.weight;
            else score += 0.08 * Math.min(commonPrefix(item.path, o.path), 4) / 4;
        }

        if (tokens && tokens.size) {
            const first = item.path.split('.').slice(0, 3);
            let hits = 0;
            for (const s of first) if (tokens.has(s.toLowerCase())) hits++;
            score += 0.25 * Math.min(hits, 2) / 2;
        }

        let nearBest = 0;
        for (const n of near) {
            const cp = commonPrefix(item.path, n.path);
            if (cp) nearBest = Math.max(nearBest, cp / Math.max(n.path.split('.').length, 1) / (1 + n.dist / 40));
        }
        score += 0.15 * nearBest;
        out.push({ item, score, typeOk });
    }
    out.sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path));
    return out;
}

const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
const camel = (words) => words.map(w => cap(w.replace(/[^\wäöüÄÖÜß]/g, ''))).join('');

/**
 * ID-Vorschläge für den id-Parameter eines Aufrufs.
 * @param widget  Widget-Beschreibung
 * @param call    twig-Aufruf (oder null)
 * @param used    Set der IDs, die auf der Seite schon vorkommen
 * @param tokens  Raum-Wörter aus dem Dateinamen
 */
function suggestIds(widget, call, used, tokens) {
    const out = [];
    const add = (id, why) => {
        if (!id) return;
        let cand = id, n = 2;
        while (used.has(cand)) cand = id + n++;
        if (!out.some(o => o.id === cand)) out.push({ id: cand, why });
    };
    let path = null;
    if (call) {
        call.args.forEach((a, i) => {
            if (!path && isItemParam(widget.params[i])) path = pathsOf(a)[0] || null;
        });
    }
    const macro = widget.macro || widget.name.split('.').pop();
    if (path) {
        const segs = path.split('.');
        let rest = segs.filter((s, i) => !(i < 3 && tokens && tokens.has(s.toLowerCase())));
        if (rest.length > 1 && GENERIC_SEG.has(rest[rest.length - 1].toLowerCase())) rest = rest.slice(0, -1);
        const short = camel(rest.slice(-3));
        add(short, 'item');
        add(short + cap(macro), 'item');
        const room = tokens ? [...tokens].pop() : '';
        if (room) add(cap(room) + '_' + short, 'item');
        add(camel(segs), 'item');
    }
    let n = 1;
    while (used.has(cap(macro) + n)) n++;
    add(cap(macro) + n, 'widget');
    return out;
}

// Parameter, die als String in Anführungszeichen stehen (Zahlen und Widgets nicht)
function quoted(p) {
    return !p || !['value', 'widget'].includes(p.type);
}

// Platzhalter-Text für Snippets: Dollar, geschweifte Klammer und Backslash maskieren
function esc(s) {
    return String(s).replace(/[$}\\]/g, '\\$&');
}

/**
 * Snippet für einen Widget-Aufruf, z.B. "basic.flip('$3', '$1')".
 * Reihenfolge der Tabstopps: zuerst die Items (sofort Item-Suche), dann die übrigen Parameter, die ID zuletzt
 * (dann gibt es einen Vorschlag passend zum Item).
 * @param widget
 * @param opts { mode: 'learned' | 'required' | 'all', stats, first: erste Tabstopp-Nummer, prefill: true }
 * @returns { body, next } – next = nächste freie Tabstopp-Nummer
 */
function callSnippet(widget, opts = {}) {
    const params = widget.params;
    let count = 0;
    params.forEach((p, i) => { if (!p.optional) count = i + 1; });
    if (opts.mode === 'all') count = params.length;
    else if (opts.mode !== 'required' && opts.stats) count = Math.max(count, Math.min(opts.stats.usualArgCount(widget.name), params.length));
    if (count === 0 && params.length && params[0].type !== 'id') count = 1;
    if (count === 1 && params[0] && params[0].type === 'id' && params.length > 1) count = 2;

    const used = params.slice(0, count);
    const order = [];
    used.forEach((p, i) => { if (isItemParam(p)) order.push(i); });
    used.forEach((p, i) => { if (!isItemParam(p) && p.type !== 'id') order.push(i); });
    used.forEach((p, i) => { if (p.type === 'id') order.push(i); });
    let next = opts.first || 1;
    const stop = new Map();
    for (const i of order) stop.set(i, next++);

    const parts = used.map((p, i) => {
        const n = stop.get(i);
        let pre = '';
        if (opts.prefill !== false && opts.stats && !isItemParam(p) && p.type !== 'id') pre = opts.stats.typicalValue(widget.name, i) || '';
        if (pre) {
            // gelernter Wert (so wie geschrieben, inkl. Anführungszeichen)
            if (/^'.*'$/.test(pre) && quoted(p)) return `'\${${n}:${esc(pre.slice(1, -1))}}'`;
            return `\${${n}:${esc(pre)}}`;
        }
        if (p.type === 'value' && p.default !== undefined && /^-?\d+(\.\d+)?$/.test(p.default)) return `\${${n}:${p.default}}`;
        if (p.array === 'must' && !p.optional) return `[\${${n}}]`;
        return `'\${${n}}'`;
    });
    return { body: `${widget.name}(${parts.join(', ')})`, next };
}

module.exports = { rankItems, suggestIds, callSnippet, fileTokens, splitWords, quoted, esc, commonPrefix };
