'use strict';
// Texte für Hover, Parameterhilfe und Vorschlagsliste (Markdown). Ohne VS-Code-Abhängigkeit.

const { t } = require('./i18n');

// Online-Doku gibt es nicht für jede Version – nächstältere mit Doku
const DOCU_VERSION = { '2.9': '2.9', '3.0': '3.0', '3.1': '3.0', '3.2': '3.0', '3.3': '3.3', '3.4': '3.3', '3.5': '3.5', '3.6': '3.5' };
const DEFAULT_DOCU_URL = 'https://docu.smartvisu.de/{docuVersion}/index.php?page={package}/widget_{widget}';

const docuVersion = (version) => DOCU_VERSION[version] || '3.5';

function docuUrl(template, version, w) {
    if (!w || w.origin !== 'std') return null;
    const v = docuVersion(version);
    return String(template || DEFAULT_DOCU_URL)
        .replace(/\{docuVersion\}/g, v)
        .replace(/\{version\}/g, version || v)
        .replace(/\{package\}/g, w.ns)
        .replace(/\{widget\}/g, w.name)
        .replace(/\{macro\}/g, w.macro);
}

const mdEsc = (s) => String(s).replace(/[\\`*_[\]<>|]/g, '\\$&');
const oneLine = (s) => String(s || '').replace(/\s*\n\s*/g, ' ').trim();

function firstSentence(s) {
    const l = oneLine(s);
    const m = /^(.{10,}?[.!?])(\s|$)/.exec(l);
    return (m ? m[1] : l).slice(0, 120);
}

/** "item(bool, num)", "text = On", "value[?] 0..100" */
function typeText(p) {
    if (!p.type) return '';
    let s = p.type;
    if (p.array === 'must') s += '[]';
    else if (p.array === 'may') s += '[?]';
    if (p.type === 'item' && p.valid && p.valid.length) s += `(${p.valid.join(', ')})`;
    if (p.min !== undefined) s += ` ${p.min}..${p.max}`;
    return s;
}

function signature(w) {
    return `${w.name}(${w.params.map(p => p.name).join(', ')})`;
}

// Wörter, die in einer Parameterbeschreibung nichts über Typ und Name hinaus sagen ("an item", "unique id for this widget")
const TRIVIAL = new Set(['a', 'an', 'the', 'item', 'items', 'unique', 'id', 'for', 'this', 'widget', 'of']);

// Beschreibung ohne "(optional, default …)" – das steht schon in der Kopfzeile; leer, wenn sie nichts aussagt
function cleanDesc(p) {
    let d = String(p.desc || '').replace(/\s*\((?:[^()]*\b(?:optional|default)\b[^()]*)\)/gi, '').trim();
    d = d.replace(/[\s,;]*\(?\boptional\b\)?\s*$/i, '').trim();
    const words = d.toLowerCase().split(/[^a-z0-9äöüß]+/).filter(Boolean);
    return words.every(x => TRIVIAL.has(x)) ? '' : d;
}

/**
 * Zeile 1 der Parameterhilfe (reiner Text): "item — Pflicht", "min — optional".
 * Gleich in der Parameterhilfe beim Tippen und im Hover über dem Parameter.
 */
function paramLine(p) {
    return p.name + ' — ' + (p.optional ? t('param.optional') : t('param.required'));
}

/** Zeile 2: erlaubte Typen und Standardwert – "types: bool, num, str", "type: value · Standard: 0" (kann leer sein) */
function paramTypes(p) {
    const parts = [];
    if (p.type) {
        const list = p.type === 'item' && p.valid && p.valid.length ? p.valid : [p.type];
        let s = t(list.length > 1 ? 'param.types' : 'param.type', list.join(', '));
        if (p.array === 'may') s += ' ' + t('param.listMay');
        else if (p.array === 'must') s += ' ' + t('param.listMust');
        parts.push(s);
    }
    if (p.default !== undefined && p.default !== '') parts.push(t('param.default', p.default));
    return parts.join(' · ');
}

/** alles unter Zeile 1 (Markdown, kann leer sein): Typen/Standard, Beschreibung, mögliche Werte, Bereich */
function paramBody(p) {
    const parts = [];
    const types = paramTypes(p);
    if (types) parts.push(mdEsc(types));
    const d = cleanDesc(p);
    if (d) parts.push(mdEsc(d).replace(/\n/g, '  \n'));
    const facts = [];
    if (p.valid && p.type !== 'item' && !p.valid.every(v => d.includes(v))) facts.push(t('param.valid', p.valid.map(v => '`' + v + '`').join(', ')));
    if (p.min !== undefined) facts.push(t('param.range', p.min, p.max));
    if (facts.length) parts.push(facts.join('  \n'));
    return parts.join('\n\n');
}

/** Parameterhilfe als Markdown (Kopfzeile als Code + Erläuterung) */
function paramMarkdown(w, i) {
    const p = w.params[i];
    if (!p) return t('hover.tooManyArgs', w.name, w.params.length);
    const body = paramBody(p);
    return '```text\n' + paramLine(p) + '\n```' + (body ? '\n\n' + body : '');
}

/** Vorschaubild als Markdown: { uri, w, h } -> höchstens 440 px breit */
function previewMarkdown(name, preview) {
    if (!preview) return '';
    const scale = Math.min(1, 440 / preview.w);
    return `![${name}](${preview.uri}|width=${Math.round(preview.w * scale)},height=${Math.round(preview.h * scale)})`;
}

/** Beschreibung eines Widgets (Markdown) */
function widgetMarkdown(w, opts = {}) {
    const parts = [];
    let head = `**${w.name}**`;
    if (w.origin === 'std') head += ' — ' + t('widget.std', opts.version || '');
    else head += ' — ' + t('widget.custom', w.sourceName || '');
    parts.push(head);
    if (w.deprecated !== undefined) parts.push('⚠ ' + t('widget.deprecatedTag') + (w.deprecated ? ': ' + mdEsc(oneLine(w.deprecated)) : ''));
    if (w.desc) parts.push(mdEsc(w.desc).replace(/\n/g, '  \n'));
    if (opts.preview) parts.push(previewMarkdown(w.name, opts.preview) + '  \n' + t('widget.preview', opts.preview.docu));
    parts.push('```twig\n' + signature(w) + '\n```');
    if (w.params.length && opts.params !== false) {
        const rows = [`| | ${t('table.param')} | ${t('table.type')} | ${t('table.default')} | ${t('table.desc')} |`, '|--:|---|---|---|---|'];
        w.params.forEach((p, i) => {
            const d = oneLine(p.desc).replace(/\|/g, '\\|');
            rows.push(`| ${i + 1} | ${p.optional ? '' : '**'}${mdEsc(p.name)}${p.optional ? '' : '**'} | ${mdEsc(typeText(p))} | ${p.default !== undefined ? mdEsc(p.default) : ''} | ${mdEsc(d).slice(0, 220)} |`);
        });
        parts.push(rows.join('\n'));
    }
    if (w.examples && w.examples.length && opts.examples !== false) {
        parts.push(t('widget.examples') + '\n```twig\n' + w.examples.slice(0, 3).join('\n') + '\n```');
    }
    if (opts.usage) parts.push(t('widget.usage', opts.usage));
    const url = docuUrl(opts.docuUrl, opts.version, w);
    if (url) parts.push(`[${opts.docuLabel || t('widget.docu')}](${url})`);
    return parts.join('\n\n');
}

/** Item-Info (Markdown) – wenn die Erweiterung "SmartHomeNG Items" das nicht schon macht */
function itemMarkdown(item) {
    const parts = [`**${mdEsc(item.path)}**` + (item.type ? ` \`${item.type}\`` : '')];
    if (item.name) parts.push(mdEsc(item.name));
    const node = item.node;
    if (node) {
        const rows = [];
        for (const [k, a] of node.attrs) {
            if (k === 'type' || k === 'name') continue;
            const v = Array.isArray(a.value) ? '[' + a.value.join(', ') + ']' : String(a.value === null || a.value === undefined ? '' : a.value);
            rows.push(`| ${mdEsc(k)} | ${mdEsc(oneLine(v)).slice(0, 120)}${a.origin ? ' *(' + mdEsc(a.origin) + ')*' : ''} |`);
            if (rows.length >= 18) break;
        }
        if (rows.length) parts.push(`| ${t('item.attr')} | ${t('item.value')} |\n|---|---|\n` + rows.join('\n'));
        if (node.fromStruct) parts.push(t('item.fromStruct', node.fromStruct));
        if (node.children && node.children.size) parts.push(t('item.children', [...node.children.keys()].slice(0, 20).join(', ')));
    }
    return parts.join('\n\n');
}

module.exports = {
    DEFAULT_DOCU_URL, docuVersion, docuUrl, paramMarkdown, paramLine, paramTypes, paramBody, cleanDesc, widgetMarkdown, itemMarkdown, previewMarkdown, signature, typeText, firstSentence, oneLine,
    DOCU_VERSION, DEFAULT_DOCU_URL,
};
