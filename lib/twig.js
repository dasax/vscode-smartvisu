'use strict';
// Twig in smartVISU-Seiten: Ausdrücke {{ … }} / {% … %} finden, Widget-Aufrufe in Argumente zerlegen
// und den Kontext an einer Position bestimmen. Arbeitet mit Offsets im Text, ohne VS-Code-Abhängigkeit.

const IDENT_CHAIN = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;
const MAX_EXPR = 20000;

// Bezeichner (auch mit Punkten, z.B. "basic.flip") direkt vor Position i (Leerraum dazwischen erlaubt)
function identBefore(text, i, min) {
    let e = i;
    while (e > min && /\s/.test(text[e - 1])) e--;
    let s = e;
    while (s > min && /[\w.]/.test(text[s - 1])) s--;
    const name = text.slice(s, e);
    return IDENT_CHAIN.test(name) ? { name, start: s, end: e } : null;
}

/**
 * Twig-Bereich um offset: { kind: '{{' | '{%' | '{#', open, start, end, closed } oder null.
 * start/end: Inhalt ohne Klammern. Nicht geschlossene Ausdrücke enden am nächsten "{{"/"{%" bzw. nach MAX_EXPR.
 */
function exprAt(text, offset) {
    let best = null;
    for (const op of ['{{', '{%', '{#']) {
        const i = text.lastIndexOf(op, offset - 2);
        if (i >= 0 && (!best || i > best.open)) best = { kind: op, open: i };
    }
    if (!best) return null;
    const closer = { '{{': '}}', '{%': '%}', '{#': '#}' }[best.kind];
    const start = best.open + 2;
    const close = text.indexOf(closer, start);
    if (close >= 0 && close + 2 <= offset) return null;      // vor dem Cursor geschlossen
    let end = close >= 0 ? close : text.length;
    for (const op of ['{{', '{%']) {
        const n = text.indexOf(op, start);
        if (n >= 0 && n < end) end = n;
    }
    end = Math.min(end, start + MAX_EXPR);
    if (end < offset) return null;
    return { kind: best.kind, open: best.open, start, end, closed: close >= 0 && close === end };
}

/** alle Twig-Bereiche im Text: [{ kind, open, start, end }] (Kommentare {# #} werden übersprungen) */
function allExprs(text) {
    const out = [];
    const re = /\{([{%#])/g;
    let m;
    while ((m = re.exec(text))) {
        const kind = '{' + m[1];
        const closer = { '{{': '}}', '{%': '%}', '{#': '#}' }[kind];
        const start = m.index + 2;
        const close = text.indexOf(closer, start);
        const end = close >= 0 ? close : text.length;
        if (kind !== '{#') out.push({ kind, open: m.index, start, end, closed: close >= 0 });
        re.lastIndex = close >= 0 ? close + 2 : text.length;
    }
    return out;
}

// Literal aus einem Argument: string | number | array | const | empty | expr
function literal(text, s, e) {
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    const t = text.slice(s, e);
    if (!t) return { kind: 'empty', start: s, end: e, raw: '' };
    const q = t[0];
    if ((q === "'" || q === '"') && t.length >= 2 && t[t.length - 1] === q) {
        let ok = true;
        for (let i = 1; i < t.length - 1; i++) {
            if (t[i] === '\\') i++;
            else if (t[i] === q) { ok = false; break; }
        }
        if (ok) return { kind: 'string', value: t.slice(1, -1), start: s, end: e, raw: t };
    }
    if (/^-?\d+(?:\.\d+)?$/.test(t)) return { kind: 'number', value: t, start: s, end: e, raw: t };
    if (/^(true|false|null|none)$/i.test(t)) return { kind: 'const', value: t, start: s, end: e, raw: t };
    if (t[0] === '[' && t[t.length - 1] === ']') {
        const items = splitTop(text, s + 1, e - 1).map(r => literal(text, r.start, r.end)).filter(l => l.kind !== 'empty');
        return { kind: 'array', items, start: s, end: e, raw: t };
    }
    return { kind: 'expr', start: s, end: e, raw: t };
}

// Bereich [s, e) an Kommas der obersten Ebene teilen (Strings und Klammern beachten)
function splitTop(text, s, e) {
    const out = [];
    let depth = 0;
    let seg = s;
    for (let i = s; i < e; i++) {
        const c = text[i];
        if (c === "'" || c === '"') {
            i++;
            while (i < e && text[i] !== c) { if (text[i] === '\\') i++; i++; }
        } else if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        else if (c === ',' && depth === 0) {
            out.push({ start: seg, end: i });
            seg = i + 1;
        }
    }
    out.push({ start: seg, end: e });
    return out;
}

/**
 * Ausdruck [start, end) zerlegen.
 * @returns { calls: [{ name, nameStart, nameEnd, open, close, args: [lit], commas: [offset], parent }],
 *            strings: [{ start, end, quote, closed }], arrays: [{ open, close, call, argIndex }] }
 *   close = -1 bei nicht geschlossenem Aufruf; strings.start/end = Inhalt ohne Anführungszeichen
 */
function parseExpr(text, start, end) {
    const calls = [];
    const strings = [];
    const arrays = [];
    const stack = [{ type: 'root', seg: start }];
    const callOf = () => {
        for (let k = stack.length - 1; k > 0; k--) if (stack[k].call) return stack[k];
        return null;
    };
    let i = start;
    while (i < end) {
        const c = text[i];
        if (c === "'" || c === '"') {
            let j = i + 1;
            while (j < end && text[j] !== c && text[j] !== '\n') { if (text[j] === '\\') j++; j++; }
            const closed = j < end && text[j] === c;
            strings.push({ start: i + 1, end: Math.min(j, end), quote: c, closed });
            i = closed ? j + 1 : j;
            continue;
        }
        if (c === '(') {
            const id = identBefore(text, i, start);
            const frame = { type: '(', seg: i + 1 };
            if (id) {
                const parentFrame = callOf();
                frame.call = { name: id.name, nameStart: id.start, nameEnd: id.end, open: i, close: -1, args: [], commas: [], parent: parentFrame ? parentFrame.call : null };
                calls.push(frame.call);
            }
            stack.push(frame);
        } else if (c === '[' || c === '{') {
            const frame = { type: c, seg: i + 1 };
            if (c === '[') {
                const top = stack[stack.length - 1];
                if (top.call) {
                    frame.array = { open: i, close: -1, call: top.call, argIndex: top.call.commas.length };
                    arrays.push(frame.array);
                }
            }
            stack.push(frame);
        } else if (c === ',') {
            const top = stack[stack.length - 1];
            if (top.call) {
                top.call.args.push(literal(text, top.seg, i));
                top.call.commas.push(i);
            }
            top.seg = i + 1;
        } else if (c === ')' || c === ']' || c === '}') {
            const want = c === ')' ? '(' : (c === ']' ? '[' : '{');
            let k = stack.length - 1;
            while (k > 0 && stack[k].type !== want) k--;
            if (k > 0) {
                const f = stack[k];
                if (f.call) {
                    f.call.args.push(literal(text, f.seg, i));
                    f.call.close = i;
                }
                if (f.array) f.array.close = i;
                stack.length = k;
            }
        }
        i++;
    }
    for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].call) stack[k].call.args.push(literal(text, stack[k].seg, end));
    }
    // "f()" hat keine Argumente
    for (const call of calls) if (call.args.length === 1 && call.args[0].kind === 'empty') call.args = [];
    return { calls, strings, arrays };
}

/** alle Aufrufe mit Punkt im Namen (Widgets) im Text – für Diagnosen und zum Lernen */
function allCalls(text) {
    const out = [];
    for (const ex of allExprs(text)) {
        if (ex.kind === '{%' && /^\s*-?\s*(macro|import|from|extends|include|block|endblock|endmacro)\b/.test(text.slice(ex.start, ex.start + 30))) continue;
        for (const c of parseExpr(text, ex.start, ex.end).calls) if (c.name.includes('.')) out.push(c);
    }
    return out;
}

// Liegt offset innerhalb eines HTML-Tags (<div …|>)?
function inHtmlTag(text, offset) {
    const lt = text.lastIndexOf('<', offset - 1);
    const gt = text.lastIndexOf('>', offset - 1);
    return lt > gt && /[A-Za-z/!]/.test(text[lt + 1] || '');
}

// Liegt offset in <script>…</script>, <style>…</style> oder <!-- … -->?
function inRawBlock(text, offset) {
    const low = text.slice(Math.max(0, offset - 20000), offset).toLowerCase();
    const after = (open, close) => {
        const o = low.lastIndexOf(open);
        return o >= 0 && low.lastIndexOf(close) < o;
    };
    return after('<script', '</script') || after('<style', '</style') || after('<!--', '-->');
}

/**
 * Kontext an der Position offset.
 * @returns { kind: 'text' | 'tag' | 'raw' | 'comment' }
 *        | { kind: 'expr', ex, calls, call, argIndex, arg, str, inArray, prefixStart }
 *   call: innerster Aufruf, in dessen Klammern offset liegt (oder null)
 *   str:  String, in dem offset liegt ({ start, end, quote, closed }) oder null
 *   prefixStart: Anfang des Worts (Buchstaben, Ziffern, Punkte) vor offset
 */
function contextAt(text, offset) {
    const ex = exprAt(text, offset);
    if (!ex) {
        if (inRawBlock(text, offset)) return { kind: 'raw' };
        return { kind: inHtmlTag(text, offset) ? 'tag' : 'text' };
    }
    if (ex.kind === '{#') return { kind: 'comment' };
    const p = parseExpr(text, ex.start, ex.end);
    let call = null;
    for (const c of p.calls) {
        if (c.open < offset && (c.close < 0 || offset <= c.close) && (!call || c.open > call.open)) call = c;
    }
    const str = p.strings.find(s => s.start <= offset && offset <= s.end) || null;
    let argIndex = -1;
    let arg = null;
    let inArray = false;
    if (call) {
        argIndex = call.commas.filter(c => c < offset).length;
        arg = call.args[argIndex] || null;
        inArray = p.arrays.some(a => a.call === call && a.argIndex === argIndex && a.open < offset && (a.close < 0 || offset <= a.close));
    }
    let prefixStart = offset;
    while (prefixStart > ex.start && /[\w.]/.test(text[prefixStart - 1])) prefixStart--;
    return { kind: 'expr', ex, calls: p.calls, call, argIndex, arg, str, inArray, prefixStart };
}

/** {% import "datei.html" as alias %} – [{ file, alias, start, end }] */
function imports(text) {
    const out = [];
    const re = /\{%-?\s*import\s+(["'])([^"']+)\1\s+as\s+(\w+)\s*-?%\}/g;
    let m;
    while ((m = re.exec(text))) out.push({ file: m[2], alias: m[3], start: m.index + m[0].indexOf(m[2]), end: m.index + m[0].indexOf(m[2]) + m[2].length });
    return out;
}

/** {% extends "x.html" %} – Dateiname oder null */
function extendsOf(text) {
    const m = /\{%-?\s*extends\s+(["'])([^"']+)\1/.exec(text);
    return m ? m[2] : null;
}

/** Zeilennummer (0-basiert) zu einem Offset – mit vorab berechneten Zeilenanfängen */
function lineIndex(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    return (offset) => {
        let lo = 0, hi = starts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
        }
        return lo;
    };
}

module.exports = { exprAt, allExprs, parseExpr, allCalls, contextAt, literal, splitTop, imports, extendsOf, inHtmlTag, inRawBlock, lineIndex, identBefore };
