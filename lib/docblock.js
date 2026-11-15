'use strict';
// Liest die Widget-Beschreibungen (Docblocks) aus smartVISU-Widgetdateien – nachgebaut nach twig_docu()
// in smartVISU lib/functions_twig.php, damit Typen, Pflicht-/optionale Parameter, Standardwerte,
// Wertelisten und Bereiche genauso erkannt werden wie vom Widget-Assistenten von smartVISU.
// Ohne VS-Code-Abhängigkeit: wird auch vom Generator (tools/generate-widgets.js) benutzt.

const BUTTON_TYPES = ['micro', 'mini', 'midi', 'icon'];
const ICON_CLASSES = ['icon0', 'icon1', 'icon2', 'icon3', 'icon4', 'icon5'];

// "/** … */" + "{% macro name(a, b, _hidden) %}"
const MACRO_RE = /\{%-?\s*macro\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*-?%\}/g;

function cleanLine(l) {
    return l.replace(/^\s*\*+ ?/, '').replace(/\s+$/, '');
}

// Kommentar direkt vor der Position (nur Leerraum dazwischen) – sonst null
function docBefore(text, pos) {
    let i = pos;
    while (i > 0 && /\s/.test(text[i - 1])) i--;
    if (text.slice(i - 2, i) !== '*/') return null;
    const start = text.lastIndexOf('/**', i - 2);
    if (start < 0) return null;
    return { start, body: text.slice(start + 3, i - 2) };
}

function parseParamTag(rest) {
    // "{item[?](bool,num)=default} Beschreibung" – Typ-Block ist optional
    const m = /^\{([^}]*?)\}\s*([\s\S]*)$/.exec(rest);
    const p = {};
    let desc = rest;
    if (m) {
        desc = m[2];
        const t = /^([^[(=]+?)(\[\??\])?(\(.*?\))?(=[\s\S]*)?$/.exec(m[1].trim());
        if (t) {
            p.type = t[1].trim();
            if (t[2] === '[?]') p.array = 'may';
            else if (t[2] === '[]') p.array = 'must';
            if (t[3]) {
                const inner = t[3].slice(1, -1);
                const range = /^(.*\d)\.\.(\d.*)$/.exec(inner);
                if (p.type === 'id') {
                    if (inner === 'nonunique') p.unique = false;
                } else if (range) {
                    p.min = range[1];
                    p.max = range[2];
                } else {
                    p.valid = inner.split(',').map(s => s.trim()).filter(s => s !== '');
                }
            }
            if (p.type === 'type') p.valid = BUTTON_TYPES.concat((p.valid || []).filter(v => !BUTTON_TYPES.includes(v)));
            if (p.type === 'color' && p.valid && p.valid.includes('icon0to5')) {
                p.valid = ICON_CLASSES.concat(p.valid.filter(v => v !== 'icon0to5'));
            }
            p.optional = t[4] !== undefined;
            if (p.optional && t[4] !== '=') p.default = t[4].slice(1);
        }
    }
    p.desc = desc.split(/\r?\n/).map(cleanLine).join('\n').trim();
    if (p.optional === undefined) p.optional = /\(optional/i.test(p.desc);
    return p;
}

/**
 * Widgets einer Datei.
 * @param text      Dateiinhalt
 * @param ns        Namensraum (Dateiname ohne .html bzw. Alias aus {% import … as alias %})
 * @returns [{ name, ns, macro, params: [{ name, type, optional, default, valid, min, max, array, unique, desc }],
 *             desc, see, deprecated, line }]
 */
function parseWidgets(text, ns) {
    text = text.replace(/^﻿/, '');
    const out = [];
    MACRO_RE.lastIndex = 0;
    let m;
    while ((m = MACRO_RE.exec(text))) {
        const macro = m[1];
        // Parameter bis zum ersten mit "_" beginnenden (versteckte Parameter, wie in twig_docu)
        const names = [];
        for (const raw of m[2].split(',')) {
            const n = raw.split('=')[0].trim();
            if (!n) continue;
            if (n.startsWith('_')) break;
            names.push(n);
        }
        const doc = docBefore(text, m.index);
        const w = {
            name: `${ns}.${macro}`,
            ns,
            macro,
            params: [],
            desc: '',
            line: text.slice(0, m.index).split('\n').length - 1,
        };
        const docParams = [];
        if (doc) {
            const lines = doc.body.split(/\r?\n/);
            // Tags beginnen am Zeilenanfang mit "@" (nach "*" und Leerraum)
            const chunks = [];
            let cur = { tag: null, text: [] };
            for (const l of lines) {
                const tm = /^[\s*]*@(\w+)\s*(.*)$/.exec(l);
                if (tm) {
                    chunks.push(cur);
                    cur = { tag: tm[1], text: [tm[2]] };
                } else cur.text.push(l);
            }
            chunks.push(cur);
            for (const c of chunks) {
                if (!c.tag) {
                    w.desc = c.text.map(cleanLine).join('\n').replace(/^\*$/gm, '').trim();
                } else if (c.tag === 'param') {
                    docParams.push(parseParamTag(c.text.join('\n').trim()));
                } else if (c.tag === 'see') {
                    const [page, anchor] = c.text[0].trim().split('#');
                    (w.see = w.see || []).push({ page, anchor: anchor || '' });
                } else {
                    w[c.tag] = c.text.map(cleanLine).join('\n').trim();
                }
            }
        }
        w.params = names.map((name, i) => Object.assign({ name }, docParams[i] || { optional: false, desc: '' }));
        // aufräumen: leere Felder weglassen (kleinere JSON-Dateien)
        for (const p of w.params) {
            for (const k of Object.keys(p)) if (p[k] === undefined || p[k] === '') delete p[k];
        }
        out.push(w);
    }
    return out;
}

/** Einfache Liste aus deprecated.yaml ("removed:" / "deprecated:" mit "- name") */
function parseDeprecated(text) {
    const res = { removed: [], deprecated: [] };
    let section = null;
    for (const l of String(text || '').split(/\r?\n/)) {
        const s = /^(\w+):\s*$/.exec(l);
        if (s) { section = res[s[1]] ? s[1] : null; continue; }
        const e = /^\s*-\s*([\w.]+)/.exec(l);
        if (e && section) res[section].push(e[1]);
    }
    return res;
}

/** Beispielaufrufe aus einer Doku-Seite (pages/docu/<pkg>/widget_<pkg>.<name>.html) */
function parseExamples(text, widget) {
    const dec = String(text || '')
        .replace(/&#123;/g, '{').replace(/&#125;/g, '}').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const out = [];
    const esc = widget.replace(/\./g, '\\.');
    const re = new RegExp(`\\{\\{\\s*${esc}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(dec)) && out.length < 4) {
        // bis zur passenden "}}" – Klammern zählen, damit mehrzeilige Aufrufe ganz bleiben
        const end = dec.indexOf('}}', m.index);
        if (end < 0) break;
        const call = dec.slice(m.index, end + 2).replace(/\s*\n\s*/g, ' ');
        if (!out.includes(call)) out.push(call);
        re.lastIndex = end;
    }
    return out;
}

module.exports = { parseWidgets, parseDeprecated, parseExamples, BUTTON_TYPES, ICON_CLASSES };
