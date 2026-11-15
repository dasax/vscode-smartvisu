'use strict';
// Prüfungen für smartVISU-Seiten: unbekannte/entfernte/veraltete Widgets, Parameterzahl, Items,
// Wertelisten, Wertebereiche und doppelte IDs. Ohne VS-Code-Abhängigkeit.
// Ergebnis: [{ start, end, severity: 'error'|'warning'|'info', message, deprecated? }]

const { t } = require('./i18n');
const { allCalls, imports } = require('./twig');
const { PATH_RE, isItemParam } = require('./learn');

/**
 * @param text   Seiteninhalt
 * @param view   { get(name), namespaces: Set, removed: Set, deprecated: Set, version }
 * @param items  Map(Pfad -> { type }) oder null (keine Item-Quelle)
 * @param opts   { importOk(file) -> bool }
 */
function check(text, view, items, opts = {}) {
    const out = [];
    const add = (start, end, severity, message, extra) => out.push(Object.assign({ start, end, severity, message }, extra));
    const ids = new Map();

    for (const call of allCalls(text)) {
        const w = view.get(call.name);
        const ns = call.name.split('.')[0];
        if (!w) {
            if (view.removed.has(call.name)) add(call.nameStart, call.nameEnd, 'error', t('diag.removed', call.name, view.version));
            else if (view.namespaces.has(ns)) add(call.nameStart, call.nameEnd, 'warning', t('diag.unknownWidget', call.name, view.version));
            continue;
        }
        if (w.deprecated !== undefined || view.deprecated.has(w.name)) {
            add(call.nameStart, call.nameEnd, 'info', t('diag.deprecated', w.name), { deprecated: true });
        }
        const n = call.args.length;
        if (n > w.params.length) {
            const a = call.args[w.params.length];
            add(a.start, call.args[n - 1].end || a.start + 1, 'warning', t('diag.tooMany', w.name, n, w.params.length));
        }
        let required = 0;
        w.params.forEach((p, i) => { if (!p.optional && p.type) required = i + 1; });
        if (n < required && call.close >= 0) {
            const missing = w.params.slice(n, required).filter(p => !p.optional).map(p => p.name);
            add(call.nameStart, call.nameEnd, 'warning', t('diag.missing', w.name, missing.join(', ')));
        }

        call.args.forEach((a, i) => {
            const p = w.params[i];
            if (!p) return;
            if (p.type === 'id' && a.kind === 'string' && a.value && p.unique !== false) {
                const prev = ids.get(a.value);
                if (prev !== undefined) add(a.start, a.end, 'warning', t('diag.dupId', a.value, prev.line + 1));
                else ids.set(a.value, { line: text.slice(0, a.start).split('\n').length - 1 });
            }
            if (isItemParam(p) && items) {
                const lits = a.kind === 'array' ? a.items : [a];
                for (const l of lits) {
                    if (l.kind !== 'string' || !l.value || !PATH_RE.test(l.value)) continue;
                    const it = items.get(l.value);
                    if (!it) add(l.start, l.end, 'warning', t('diag.itemMissing', l.value));
                    else if (p.valid && p.valid.length && it.type && it.type !== 'foo' && !p.valid.includes(it.type)) {
                        add(l.start, l.end, 'info', t('diag.itemType', l.value, it.type, p.valid.join(', ')));
                    }
                }
            }
            if ((p.type === 'type' || p.type === 'text') && p.valid && a.kind === 'string' && a.value && !p.array) {
                if (!p.valid.includes(a.value)) add(a.start, a.end, 'info', t('diag.notValid', a.value, p.name, p.valid.join(', ')));
            }
            if (p.min !== undefined && a.kind === 'number') {
                const v = +a.value;
                if (v < +p.min || v > +p.max) add(a.start, a.end, 'info', t('diag.range', a.value, p.name, p.min, p.max));
            }
        });
    }

    if (opts.importOk) {
        for (const im of imports(text)) {
            if (!opts.importOk(im.file)) add(im.start, im.end, 'warning', t('diag.importMissing', im.file));
        }
    }
    return out;
}

module.exports = { check };
