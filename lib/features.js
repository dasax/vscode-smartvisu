'use strict';
// Sprachfunktionen für smartVISU-Seiten: Autovervollständigung (Widgets, Struktur-Snippets, Items, Parameterwerte,
// Icons, Seiten, Vorlagen), Parameterhilfe, Hover, Gehe zu Definition, Diagnosen und automatisches Öffnen
// der Vorschlagsliste beim Springen zwischen den Platzhaltern eines Snippets.

const vscode = require('vscode');
const twig = require('./twig');
const { t } = require('./i18n');
const { rankItems, suggestIds, callSnippet, fileTokens, quoted } = require('./rank');
const path = require('path');
const { paramLine, paramBody, widgetMarkdown, itemMarkdown, previewMarkdown, signature, firstSentence } = require('./present');
const { structureSnippets } = require('./snippets');
const { check } = require('./check');
const { foldingRanges } = require('./folding');
const { isItemParam, pathsOf } = require('./learn');
const { SHNG_EXT } = require('./items');

const LANGS = ['html', 'twig', 'jinja-html', 'django-html', 'nunjucks', 'jinja', 'twig-html'];
const SELECTOR = LANGS.map(language => ({ language }));
const cfg = () => vscode.workspace.getConfiguration('smartvisu');

const DURATIONS = [['30i', '30 min'], ['1h', '1 h'], ['6h', '6 h'], ['12h', '12 h'], ['24h', '24 h'], ['1d', '1 d'], ['2d', '2 d'],
    ['1w', '1 w'], ['1m', '1 month'], ['1y', '1 y'], ['now', 'now']];
const MODES = ['avg', 'sum', 'min', 'max', 'minmax', 'minmaxavg', 'on', 'raw'];
const FORMULAS = ['VAR', 'or', 'and', 'VAR1', 'SUM(VAR)', 'AVG(VAR)', 'MIN(VAR)', 'MAX(VAR)', 'VAR1 > 0 ? 1 : 0'];
// Namensräume in der Reihenfolge, in der sie ohne Nutzungsdaten erscheinen
const NS_ORDER = ['basic', 'device', 'status', 'plot', 'icon', 'clock', 'weather', 'calendar', 'multimedia', 'phone', 'popup', 'quad', 'appliance', 'lib', 'forms'];

const KIND = {
    widget: vscode.CompletionItemKind.Function,
    custom: vscode.CompletionItemKind.Method,
    snippet: vscode.CompletionItemKind.Snippet,
    item: vscode.CompletionItemKind.Field,
    itemOther: vscode.CompletionItemKind.Reference,
    value: vscode.CompletionItemKind.Value,
    enum: vscode.CompletionItemKind.EnumMember,
    learned: vscode.CompletionItemKind.Constant,
    icon: vscode.CompletionItemKind.File,
    file: vscode.CompletionItemKind.File,
    id: vscode.CompletionItemKind.Keyword,
};

const pad = (i) => String(i).padStart(5, '0');

// Vorschaubilder aus der smartVISU-Doku (tools/generate-previews.js)
let PREVIEWS = {};
try {
    PREVIEWS = require('../media/previews/index.json');
} catch { /* ohne Vorschaubilder */ }

function previewFor(w) {
    const p = w && w.origin === 'std' && PREVIEWS[w.name];
    if (!p) return null;
    return Object.assign({ uri: vscode.Uri.file(path.join(__dirname, '..', 'media', 'previews', w.name + '.png')).toString() }, p);
}

// Vorschaubilder der Code-Blöcke, mit Beispielinhalt gerendert (tools/generate-block-previews.js)
let BLOCK_PREVIEWS = {};
try {
    BLOCK_PREVIEWS = require('../media/previews/blocks/index.json');
} catch { /* ohne Vorschaubilder */ }

/** Hilfe zu einem Code-Block: Vorschaubild (falls vorhanden) und Code; mit Titelzeile für den Guide */
function snippetDoc(s, withTitle) {
    const md = new vscode.MarkdownString(withTitle ? `**${s.desc}** — \`sv:${s.key}\`\n\n` : '');
    const p = BLOCK_PREVIEWS[s.key];
    if (p) {
        const uri = vscode.Uri.file(path.join(__dirname, '..', 'media', 'previews', 'blocks', s.key + '.png')).toString();
        md.appendMarkdown(previewMarkdown('sv:' + s.key, Object.assign({ uri }, p)) + '  \n' + t('snip.preview') + '\n\n');
    }
    return md.appendCodeblock(snippetPreview(s.body), 'html');
}

function widgetDoc(c, w) {
    return new vscode.MarkdownString(widgetMarkdown(w, {
        version: c.catalog.version, docuUrl: cfg().get('docuUrl'), usage: c.info.stats.widgets.get(w.name), preview: previewFor(w),
    }));
}

/**
 * Items, deren Typ zum Parameter passt (Einstellung smartvisu.items.typeFilter):
 *  - "learned": Typen, die auf den Seiten für diesen Parameter verwendet werden (z.B. basic.flip -> nur bool),
 *               sonst die Typen laut Widget-Beschreibung
 *  - "widget":  Typen laut Widget-Beschreibung (basic.flip: bool, num, str)
 *  - "off":     alle Items
 * Bleibt nichts übrig, kommen alle Items (passende zuerst, siehe rankItems).
 */
function filterItemTypes(c, w, i, p) {
    const all = [...c.items.items.values()];
    const mode = cfg().get('items.typeFilter') || 'learned';
    if (mode === 'off') return all;
    const valid = new Set((p && p.type === 'item' && p.valid) || []);
    let allowed = valid;
    if (mode === 'learned') {
        const used = c.info.stats.itemTypesFor(w.name, i, c.items.items);
        const both = new Set([...used].filter(t => !valid.size || valid.has(t)));
        if (both.size) allowed = both;
    }
    if (!allowed.size) return all;
    const out = all.filter(it => allowed.has(it.type || 'foo'));
    return out.length ? out : all;
}

// Parameterhilfe: Kopfzeile wie in der Parameterhilfe (als Code) und Erläuterung – getrennt wie dort
function paramHover(p) {
    const parts = [new vscode.MarkdownString().appendCodeblock(paramLine(p), 'text')];
    const body = paramBody(p);
    if (body) parts.push(new vscode.MarkdownString(body));
    return parts;
}

function snippetPreview(body) {
    return body
        .replace(/\$\{\d+\|([^,|]*)[^}]*\|\}/g, '$1')
        .replace(/\$\{\d+:([^}]*)\}/g, '$1')
        .replace(/\$\{\d+\}|\$\d+/g, '')
        .replace(/\$\{CURRENT_YEAR\}/g, String(new Date().getFullYear()))
        .replace(/\\([$}\\])/g, '$1');
}

class Features {
    constructor(env) {
        this.env = env;
        this.diagnostics = vscode.languages.createDiagnosticCollection('smartvisu');
        this.lastTrigger = 0;
        this.timers = new Map();
    }

    ctx(doc) {
        return this.env.forDocument(doc);
    }

    // --------------------------------------------------------------------------- Bausteine

    widgetOrder(c) {
        const stats = c.info.stats;
        const list = c.view.all();
        const nsRank = (ns) => {
            const i = NS_ORDER.indexOf(ns);
            return i < 0 ? NS_ORDER.length - 2 : i;
        };
        return list.map(w => ({ w, used: stats.widgets.get(w.name) || 0 }))
            .sort((a, b) => b.used - a.used || nsRank(a.w.ns) - nsRank(b.w.ns) || a.w.name.localeCompare(b.w.name))
            .map(x => x.w);
    }

    widgetItem(c, w, range, opts) {
        const ci = new vscode.CompletionItem({ label: w.name, description: firstSentence(w.desc) || (w.origin === 'custom' ? w.sourceName : '') },
            w.origin === 'custom' ? KIND.custom : KIND.widget);
        ci.detail = signature(w);
        if (opts.nameOnly) ci.insertText = w.name;
        else {
            const s = callSnippet(w, { mode: cfg().get('insertParameters'), stats: c.info.stats });
            ci.insertText = new vscode.SnippetString(opts.braces ? `{{ ${s.body} }}` : s.body);
            ci.command = { command: 'smartvisu.afterInsert', title: '' };
        }
        ci.range = range;
        ci.filterText = w.name;
        if (w.deprecated !== undefined || c.view.deprecated.has(w.name)) ci.tags = [vscode.CompletionItemTag.Deprecated];
        ci._widget = w;
        ci._ctx = c;
        return ci;
    }

    widgetItems(c, range, opts) {
        return this.widgetOrder(c).map((w, i) => {
            const ci = this.widgetItem(c, w, range, opts);
            ci.sortText = (opts.sortPrefix || 'a') + pad(i);
            return ci;
        });
    }

    /** Struktur-Snippets für eine Seite: [{ key, desc, body, keywords }] (auch für den Guide) */
    snippetsFor(c, doc) {
        return structureSnippets({
            view: c.view,
            stats: c.info.stats,
            mode: cfg().get('insertParameters'),
            version: c.catalog.version,
            templates: c.info.templatesFor(doc.fileName),
            partials: c.info.partials,
            macroFiles: c.info.macroFiles,
        });
    }

    snippetItems(c, range, doc) {
        return this.snippetsFor(c, doc).map((s, i) => {
            const ci = new vscode.CompletionItem({ label: 'sv:' + s.key, description: s.desc }, KIND.snippet);
            ci.insertText = new vscode.SnippetString(s.body);
            ci.range = range;
            ci.filterText = `sv:${s.key} ${s.keywords}`;
            ci.sortText = 'b' + pad(i);
            ci.detail = t('snip.detail');
            ci.documentation = snippetDoc(s);
            ci.command = { command: 'smartvisu.afterInsert', title: '' };
            return ci;
        });
    }

    /**
     * Wert-Vorschlag für einen Parameter. raw = Text so, wie er im Aufruf stehen soll ('mini', [1, 0], 255).
     * Im String wird nur der Inhalt ersetzt; Nicht-String-Werte entfernen dabei die Anführungszeichen.
     */
    valueItem(doc, place, raw, kind, description, sortIndex) {
        const isStr = /^'.*'$|^".*"$/s.test(raw);
        const label = isStr && place.str ? raw.slice(1, -1) : raw;
        const ci = new vscode.CompletionItem({ label, description }, kind);
        ci.range = place.range;
        if (place.str) {
            if (isStr) ci.insertText = raw.slice(1, -1);
            else {
                ci.insertText = raw;
                const edits = [new vscode.TextEdit(new vscode.Range(doc.positionAt(place.str.start - 1), doc.positionAt(place.str.start)), '')];
                if (place.str.closed) edits.push(new vscode.TextEdit(new vscode.Range(doc.positionAt(place.str.end), doc.positionAt(place.str.end + 1)), ''));
                ci.additionalTextEdits = edits;
            }
        } else ci.insertText = raw;
        ci.filterText = typeof ci.insertText === 'string' ? ci.insertText : label;
        ci.sortText = pad(sortIndex);
        return ci;
    }

    // --------------------------------------------------------------------------- Autovervollständigung

    async provideCompletionItems(doc, pos, token, cctx) {
        const line = doc.lineAt(pos.line).text;
        const before = line.slice(0, pos.character);
        const after = line.slice(pos.character);
        const trig = cctx.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter ? cctx.triggerCharacter : null;
        // Leerzeichen und "=" nur an den Stellen, an denen sie etwas bedeuten (Rest kostet nur Zeit)
        if (trig === ' ' && !/(\{[{%]-?|[(,[])\s$|\{%-?\s*\w+\s$/.test(before)) return undefined;
        if (trig === '=' && !/page=$/.test(before)) return undefined;
        if (!this.env.isCandidate(doc)) return undefined;
        const c = await this.ctx(doc);
        if (!c || token.isCancellationRequested) return undefined;
        const text = doc.getText();
        const off = doc.offsetAt(pos);
        const wordRange = (re) => {
            const m = re.exec(before);
            const len = m ? m[0].length : 0;
            const e = /^[\w.-]*/.exec(after)[0].length;
            return { inserting: new vscode.Range(pos.translate(0, -len), pos), replacing: new vscode.Range(pos.translate(0, -len), pos.translate(0, e)) };
        };

        // Icon nach {{ icon0 }} / {{ icon1 }} (z.B. in <img src='{{ icon0 }}light_light.svg'>)
        let m = /\{\{\s*icon[01]\s*\}\}([\w-]*)$/.exec(before);
        if (m) return this.iconItems(c, wordRange(/[\w-]*$/), !/^[\w-]*\.svg/.test(after));

        // Seitenname in index.php?page=…
        m = /index\.php\?(?:[^"'\s]*&(?:amp;)?)?page=([\w./-]*)$/.exec(before);
        if (m) {
            const range = wordRange(/[\w./-]*$/);
            return c.info.pages.map((p, i) => {
                const ci = new vscode.CompletionItem(p, KIND.file);
                ci.range = range;
                ci.sortText = pad(i);
                return ci;
            });
        }

        // Vorlagen und Makro-Dateien in {% extends / include / import "…" %}
        m = /\{%-?\s*(extends|include|import|from|embed)\s+(["'])([^"']*)$/.exec(before);
        if (m) return this.fileItems(c, m[1], wordRange(/[^"']*$/));
        m = /\{%-?\s*block\s+\w*$/.exec(before);
        if (m) {
            const range = wordRange(/\w*$/);
            return ['content', 'sidebar', 'title', 'header'].map((b, i) => Object.assign(new vscode.CompletionItem(b, KIND.enum), { range, sortText: pad(i) }));
        }

        const x = twig.contextAt(text, off);
        if (x.kind === 'text') {
            if (trig && trig !== '.') return undefined;
            // beim Tippen nur am Anfang eines Textes (nach ">" oder am Zeilenanfang), nicht mitten in einer Beschriftung;
            // Strg+Leertaste ohne angefangenes Wort zeigt die Liste überall
            const prefix = /[\w.:-]*$/.exec(before)[0];
            if (prefix && !/(^|>)\s*$/.test(before.slice(0, before.length - prefix.length))) return undefined;
            const range = wordRange(/[\w.:-]*$/);
            return new vscode.CompletionList([...this.widgetItems(c, range, { braces: true }), ...this.snippetItems(c, range, doc)], false);
        }
        if (x.kind !== 'expr') return undefined;

        if (x.call) {
            const w = c.view.get(x.call.name);
            if (w) {
                // Strg+Leertaste öffnet nur die Vorschläge – die Hilfe zum Parameter gehört darüber
                const ed = vscode.window.activeTextEditor;
                if (ed && ed.document === doc && w.params[x.argIndex]) vscode.commands.executeCommand('editor.action.triggerParameterHints');
                return this.paramItems(c, doc, x, w, trig, off, before);
            }
            if (x.str) return undefined;
        }
        if (x.str) return undefined;
        if (trig === ' ' && !/\{[{%]-?\s$/.test(before)) return undefined;
        if (trig === "'" || trig === '"' || trig === ',' || trig === '[' || trig === '(') return undefined;
        const s = x.prefixStart;
        const range = new vscode.Range(doc.positionAt(s), pos);
        const nameOnly = /^[\w.]*\s*\(/.test(after);
        return new vscode.CompletionList(this.widgetItems(c, range, { braces: false, nameOnly }), false);
    }

    iconItems(c, range, addExt) {
        return this.env.icons(c.install, c.catalog).then(icons => icons.map((n, i) => {
            const ci = new vscode.CompletionItem(n, KIND.icon);
            ci.insertText = addExt ? n + '.svg' : n;
            ci.filterText = n;
            ci.range = range;
            ci.sortText = pad(i);
            return ci;
        }));
    }

    fileItems(c, what, range) {
        let files;
        if (what === 'extends') files = c.info.templates;
        else if (what === 'import' || what === 'from') files = [...c.info.macroFiles.map(m => m.file), ...[...c.view.namespaces].map(n => `@widgets/${n}.html`)];
        else files = [...c.info.partials, ...c.info.pages.map(p => p + '.html')];
        return [...new Set(files)].map((f, i) => Object.assign(new vscode.CompletionItem(f, KIND.file), { range, sortText: pad(i) }));
    }

    // Vorschläge für den Parameter an der Cursor-Position
    async paramItems(c, doc, x, w, trig, off, before) {
        const i = x.argIndex;
        const p = w.params[i];
        if (!p) return undefined;
        // Leerzeichen nur direkt nach "(", "," oder "[" auswerten; Anführungszeichen nur beim Öffnen eines Strings
        if (trig === ' ' && !/[(,[]\s$/.test(before)) return undefined;
        if ((trig === "'" || trig === '"') && !(x.str && x.str.start === off)) return undefined;

        const text = doc.getText();
        let place;
        if (x.str) {
            const end = x.str.closed ? x.str.end : off;
            place = { str: x.str, range: { inserting: new vscode.Range(doc.positionAt(x.str.start), doc.positionAt(off)), replacing: new vscode.Range(doc.positionAt(x.str.start), doc.positionAt(Math.max(end, off))) } };
        } else {
            let e = off;
            while (e < text.length && /[\w.-]/.test(text[e])) e++;
            place = { str: null, range: { inserting: new vscode.Range(doc.positionAt(x.prefixStart), doc.positionAt(off)), replacing: new vscode.Range(doc.positionAt(x.prefixStart), doc.positionAt(e)) } };
        }
        const stats = c.info.stats;
        const learned = stats.valuesFor(w.name, i);
        const out = [];
        const seen = new Set();
        const q = (v) => (quoted(p) ? `'${String(v).replace(/'/g, "\\'")}'` : String(v));
        // Hilfe zum Parameter zeigt die Parameterhilfe – die Vorschläge selbst bleiben ohne Doku
        const add = (raw, kind, description) => {
            if (seen.has(raw)) return;
            seen.add(raw);
            out.push(this.valueItem(doc, place, raw, kind, description, out.length));
        };

        if (isItemParam(p)) return this.itemItems(c, doc, x, w, p, place, text);

        if (p.type === 'id') {
            const used = new Set();
            for (const call of twig.allCalls(text)) {
                const cw = c.view.get(call.name);
                if (!cw) continue;
                call.args.forEach((a, k) => {
                    if (cw.params[k] && cw.params[k].type === 'id' && a.kind === 'string' && a.value && a !== x.arg) used.add(a.value);
                });
            }
            for (const s of suggestIds(w, x.call, used, fileTokens(doc.fileName))) add(q(s.id), KIND.id, s.why === 'item' ? t('sug.idFromItem') : t('sug.idCounter'));
            return new vscode.CompletionList(out, false);
        }

        for (const v of learned) add(v.raw, KIND.learned, t('sug.usedTimes', v.count));
        if (p.valid) for (const v of p.valid) add(q(v), KIND.enum, v === p.default ? t('sug.default') : '');
        if (p.default !== undefined && p.default !== '') add(p.type === 'value' && /^-?\d/.test(p.default) ? p.default : q(p.default), KIND.value, t('sug.default'));
        if (!p.type && !p.valid) {
            // eigene Widgets ohne Typangabe: Werte in Anführungszeichen aus der Beschreibung ('micro', 'mini' or 'midi')
            const vals = [...new Set([...String(p.desc || '').matchAll(/'([\w.#-]+)'/g)].map(mm => mm[1]))];
            if (vals.length >= 2) for (const v of vals) add(q(v), KIND.enum, '');
        }

        if (p.type === 'image' || /^(icon|pic|image)/i.test(p.name)) {
            const icons = await this.env.icons(c.install, c.catalog);
            const ext = learned.some(v => /\.svg'?\]?$/.test(v.raw)) ? '.svg' : '';
            for (const n of icons) add(q(n + ext), KIND.icon, '');
        } else if (p.type === 'format' || p.name === 'format' || p.name === 'unit') {
            for (const f of await this.env.formats(c.install)) add(q(f), KIND.enum, t('sug.format'));
        } else if (p.type === 'duration') {
            for (const [d, label] of DURATIONS) add(q(d), KIND.enum, label);
        } else if (p.type === 'mode') {
            for (const mo of MODES) add(q(mo), KIND.enum, '');
        } else if (p.type === 'formula') {
            for (const f of FORMULAS) add(q(f), KIND.enum, '');
        } else if ((p.type === 'widget' || p.type === 'unspecified') && !x.str) {
            const range = place.range;
            out.push(...this.widgetItems(c, range, { braces: false, sortPrefix: 'z' }));
        }
        if (!out.length) return undefined;
        return new vscode.CompletionList(out, false);
    }

    itemItems(c, doc, x, w, p, place, text) {
        const items = c.items.items;
        if (!items.size) return undefined;
        // Items in der Nähe des Cursors (für die Reihenfolge)
        const lineOf = twig.lineIndex(text);
        const cur = lineOf(doc.offsetAt(place.range.inserting.start));
        const near = [];
        for (const call of twig.allCalls(text)) {
            for (const a of call.args) {
                for (const path of pathsOf(a)) if (items.has(path)) near.push({ path, dist: Math.abs(lineOf(a.start) - cur) });
            }
        }
        const ranked = rankItems(filterItemTypes(c, w, x.argIndex, p), {
            widget: w, param: p, argIndex: x.argIndex, call: x.call, stats: c.info.stats, tokens: fileTokens(doc.fileName), near,
        });
        const quote = !place.str;
        const list = ranked.map((r, i) => {
            const it = r.item;
            const desc = [it.type, it.name].filter(Boolean).join(' · ') + (r.typeOk ? '' : '  ⚠');
            const ci = new vscode.CompletionItem({ label: it.path, description: desc }, r.typeOk ? KIND.item : KIND.itemOther);
            ci.insertText = quote ? `'${it.path}'` : it.path;
            ci.filterText = it.path + (it.name ? ' ' + it.name : '');
            ci.range = place.range;
            ci.sortText = pad(i);
            if (i === 0) ci.preselect = true;
            ci._item = it;
            return ci;
        });
        return new vscode.CompletionList(list, false);
    }

    resolveCompletionItem(ci) {
        if (ci._widget && !ci.documentation) ci.documentation = widgetDoc(ci._ctx, ci._widget);
        else if (ci._item && !ci.documentation) ci.documentation = new vscode.MarkdownString(itemMarkdown(ci._item));
        return ci;
    }

    // --------------------------------------------------------------------------- Parameterhilfe

    // Nur der aktive Parameter: Kopfzeile (Name, Typ, Pflicht/optional, Standard) und darunter die Erläuterung –
    // dieselbe Ansicht wie der Hover über dem Parameter.
    async provideSignatureHelp(doc, pos) {
        const c = await this.ctx(doc);
        if (!c) return undefined;
        const x = twig.contextAt(doc.getText(), doc.offsetAt(pos));
        if (x.kind !== 'expr' || !x.call) return undefined;
        const w = c.view.get(x.call.name);
        if (!w) return undefined;
        const p = w.params[x.argIndex];
        let sig;
        if (p) {
            sig = new vscode.SignatureInformation(paramLine(p));
            const body = paramBody(p);
            sig.parameters = [new vscode.ParameterInformation([0, p.name.length], body ? new vscode.MarkdownString(body) : undefined)];
        } else {
            sig = new vscode.SignatureInformation(t('hover.tooManyArgs', w.name, w.params.length));
            sig.parameters = [];
        }
        const help = new vscode.SignatureHelp();
        help.signatures = [sig];
        help.activeSignature = 0;
        help.activeParameter = 0;
        return help;
    }

    // --------------------------------------------------------------------------- Hover

    async provideHover(doc, pos) {
        const c = await this.ctx(doc);
        if (!c) return undefined;
        const text = doc.getText();
        const off = doc.offsetAt(pos);
        const x = twig.contextAt(text, off);
        if (x.kind !== 'expr') return undefined;
        // Widget-Name
        for (const call of x.calls) {
            if (call.nameStart <= off && off <= call.nameEnd) {
                const w = c.view.get(call.name);
                if (!w) return undefined;
                return new vscode.Hover(widgetDoc(c, w), new vscode.Range(doc.positionAt(call.nameStart), doc.positionAt(call.nameEnd)));
            }
        }
        // Parameter: dieselbe Ansicht wie die Parameterhilfe beim Ausfüllen
        if (!x.call || !x.arg) return undefined;
        const w = c.view.get(x.call.name);
        if (!w || !w.params[x.argIndex]) return undefined;
        const p = w.params[x.argIndex];
        const parts = paramHover(p);
        if (isItemParam(p) && x.str && !vscode.extensions.getExtension(SHNG_EXT)) {
            // Item-Details zeigt sonst schon "SmartHomeNG Items" an
            const it = c.items.items.get(text.slice(x.str.start, x.str.end));
            if (it) parts.push(new vscode.MarkdownString(itemMarkdown(it)));
        }
        const a = x.arg;
        return new vscode.Hover(parts, new vscode.Range(doc.positionAt(a.start), doc.positionAt(Math.max(a.end, a.start))));
    }

    // --------------------------------------------------------------------------- Gehe zu Definition

    async provideDefinition(doc, pos) {
        const c = await this.ctx(doc);
        if (!c) return undefined;
        const text = doc.getText();
        const off = doc.offsetAt(pos);
        const x = twig.contextAt(text, off);
        if (x.kind !== 'expr') return undefined;
        for (const call of x.calls) {
            if (call.nameStart > off || off > call.nameEnd) continue;
            const w = c.view.get(call.name);
            if (!w) return undefined;
            if (w.source) return new vscode.Location(w.source, new vscode.Position(w.line || 0, 0));
            if (c.install && w.file) {
                const uri = vscode.Uri.joinPath(c.install.root, w.file);
                try {
                    const d = await vscode.workspace.openTextDocument(uri);
                    const i = d.getText().search(new RegExp(`\\{%-?\\s*macro\\s+${w.macro}\\s*\\(`));
                    return new vscode.Location(uri, d.positionAt(Math.max(i, 0)));
                } catch {
                    return undefined;
                }
            }
            return undefined;
        }
        // Item-Pfad: nur, wenn "SmartHomeNG Items" das nicht schon macht
        if (x.str && !vscode.extensions.getExtension(SHNG_EXT)) {
            const it = c.items.items.get(text.slice(x.str.start, x.str.end));
            if (it && it.node) return it.node.defs.map(d => new vscode.Location(d.uri, new vscode.Position(d.line, 0)));
        }
        return undefined;
    }

    // --------------------------------------------------------------------------- Faltbereiche

    provideFoldingRanges(doc) {
        const kinds = { comment: vscode.FoldingRangeKind.Comment, imports: vscode.FoldingRangeKind.Imports };
        return foldingRanges(doc.getText()).map(r => new vscode.FoldingRange(r.start, r.end, kinds[r.kind]));
    }

    // --------------------------------------------------------------------------- Diagnosen

    scheduleDiagnostics(doc, delay = 500) {
        const k = doc.uri.toString();
        clearTimeout(this.timers.get(k));
        this.timers.set(k, setTimeout(() => {
            this.timers.delete(k);
            this.updateDiagnostics(doc).catch(() => { /* z.B. Datei inzwischen geschlossen */ });
        }, delay));
    }

    async updateDiagnostics(doc) {
        if (!cfg().get('diagnostics')) {
            this.diagnostics.delete(doc.uri);
            return;
        }
        const c = await this.ctx(doc);
        if (!c) {
            this.diagnostics.delete(doc.uri);
            return;
        }
        const items = c.items.kind !== 'none' && c.items.items.size ? c.items.items : null;
        const text = doc.getText();
        const sev = { error: vscode.DiagnosticSeverity.Error, warning: vscode.DiagnosticSeverity.Warning, info: vscode.DiagnosticSeverity.Information };
        const list = check(text, c.view, items, { importOk: (f) => !c.missingImports.has(f) }).map(d => {
            const r = new vscode.Diagnostic(new vscode.Range(doc.positionAt(d.start), doc.positionAt(Math.max(d.end, d.start + 1))), d.message, sev[d.severity]);
            r.source = 'smartVISU';
            if (d.deprecated) r.tags = [vscode.DiagnosticTag.Deprecated];
            return r;
        });
        this.diagnostics.set(doc.uri, list);
    }

    // --------------------------------------------------------------------------- Vorschläge automatisch öffnen

    /**
     * Nach dem Einfügen eines Snippets und beim Springen zum nächsten Platzhalter (Tab):
     * leerer Item-/ID-/Wert-Parameter -> Vorschlagsliste, sonst Parameterhilfe;
     * leere Tabellenzelle -> Widget-Liste; leeres Icon nach {{ icon0 }} bzw. page= -> Icons/Seiten.
     */
    async maybeTrigger(editor) {
        if (!editor || !cfg().get('autoSuggest') || editor.selections.length !== 1) return;
        const doc = editor.document;
        if (!this.env.isCandidate(doc)) return;
        const sel = editor.selection;
        const pos = sel.active;
        const line = doc.lineAt(pos.line).text;
        const before = line.slice(0, sel.start.character);
        const after = line.slice(sel.end.character);
        const now = Date.now();
        if (now - this.lastTrigger < 150) return;
        const fire = (cmd) => {
            this.lastTrigger = Date.now();
            vscode.commands.executeCommand(cmd);
        };
        if (sel.isEmpty && /\{\{\s*icon[01]\s*\}\}$/.test(before) && /^\.svg/.test(after)) return fire('editor.action.triggerSuggest');
        if (sel.isEmpty && /index\.php\?(?:[^"'\s]*&(?:amp;)?)?page=$/.test(before)) return fire('editor.action.triggerSuggest');
        if (sel.isEmpty && /<td[^>]*>\s*$/i.test(before) && /^\s*<\/td>/i.test(after)) return fire('editor.action.triggerSuggest');

        const c = await this.ctx(doc);
        if (!c) return;
        const x = twig.contextAt(doc.getText(), doc.offsetAt(pos));
        if (x.kind !== 'expr' || !x.call) return;
        const w = c.view.get(x.call.name);
        if (!w || !w.params[x.argIndex]) return;
        const p = w.params[x.argIndex];
        // leerer String bzw. ganz markierter Platzhalter
        const empty = x.str && (x.str.start === x.str.end || (doc.offsetAt(sel.start) === x.str.start && doc.offsetAt(sel.end) === x.str.end));
        const suggestible = isItemParam(p) || p.type === 'id' || p.valid || p.type === 'image' || p.type === 'format' || p.type === 'duration'
            || p.type === 'mode' || c.info.stats.valuesFor(w.name, x.argIndex).length > 0;
        vscode.commands.executeCommand('editor.action.triggerParameterHints');
        if (empty && suggestible && !(isItemParam(p) && !c.items.items.size)) {
            // erst nach der Parameterhilfe, sonst schließt sie die Vorschlagsliste wieder
            setTimeout(() => fire('editor.action.triggerSuggest'), 30);
        }
    }

    // --------------------------------------------------------------------------- Registrierung

    register(context) {
        const triggers = ['.', "'", '"', ',', '(', '[', ' ', '{', '=', '/'];
        context.subscriptions.push(
            this.diagnostics,
            vscode.languages.registerCompletionItemProvider(SELECTOR, this, ...triggers),
            vscode.languages.registerSignatureHelpProvider(SELECTOR, this, { triggerCharacters: ['(', ','], retriggerCharacters: [','] }),
            vscode.languages.registerHoverProvider(SELECTOR, this),
            vscode.languages.registerDefinitionProvider(SELECTOR, this),
            vscode.languages.registerFoldingRangeProvider(SELECTOR, this),
            vscode.workspace.onDidOpenTextDocument(doc => this.scheduleDiagnostics(doc, 50)),
            vscode.workspace.onDidChangeTextDocument(e => { if (e.contentChanges.length) this.scheduleDiagnostics(e.document); }),
            vscode.workspace.onDidCloseTextDocument(doc => this.diagnostics.delete(doc.uri)),
            vscode.window.onDidChangeTextEditorSelection(e => {
                if (e.kind === vscode.TextEditorSelectionChangeKind.Command) this.maybeTrigger(e.textEditor);
            }),
            this.env.onDidChange(() => this.refreshAll()),
        );
        this.refreshAll();
    }

    refreshAll() {
        for (const doc of vscode.workspace.textDocuments) if (LANGS.includes(doc.languageId)) this.scheduleDiagnostics(doc, 100);
    }
}

module.exports = { Features, LANGS, SELECTOR, NS_ORDER, snippetPreview, snippetDoc, widgetDoc };
