'use strict';
// Guide in der Explorer-Seitenleiste (unter dem Verzeichnisbaum): alle Widgets und Code-Blöcke, die sonst
// Strg+Leertaste vorschlägt, zum Durchblättern – nach Zweck bzw. Paket geordnet, häufig verwendete oben.
// Hilfe als Tooltip, Einfügen per Klick/Enter an der Cursorposition oder durch Ziehen in den Editor,
// "Suchen …" durchsucht alles auf einmal.

const vscode = require('vscode');
const path = require('path');
const twig = require('./twig');
const { t } = require('./i18n');
const { callSnippet } = require('./rank');
const { firstSentence, docuUrl } = require('./present');
const { SELECTOR, NS_ORDER, snippetDoc, widgetDoc } = require('./features');

const VIEW = 'smartvisu.guide';
const MIME = 'application/vnd.smartvisu.guide-entry';
const FREQUENT = 12;
const cfg = () => vscode.workspace.getConfiguration('smartvisu');

// Code-Blöcke nach Zweck (Schlüssel aus snippets.js); nicht aufgeführte kommen in die letzte Gruppe
const BLOCK_GROUPS = [
    ['page', 'file-code', ['page', 'layout', 'heading', 'extends', 'twigBlock', 'include']],
    ['blocks', 'layout', ['block', 'blockSections', 'blockStatic', 'section', 'columns', 'preblock']],
    ['rows', 'table', ['table', 'row', 'rowFull', 'rowSwitch', 'rowValue', 'rowStatus', 'rowButton', 'rowSlider', 'rowTimer',
        'rowDimmer', 'rowShutter', 'rowRtr', 'rowPlot', 'buttons']],
    ['nav', 'list-tree', ['navList', 'navDivider', 'navEntry', 'navValue', 'navbar']],
    ['twig', 'symbol-keyword', ['import', 'if', 'for', 'macro']],
];

const icon = (i) => (Array.isArray(i) ? new vscode.ThemeIcon(i[0], new vscode.ThemeColor(i[1])) : new vscode.ThemeIcon(i));
// Text zum Schlüssel oder '' (statt des Schlüssels), wenn es keinen gibt
const tOpt = (key) => {
    const s = t(key);
    return s === key ? '' : s;
};

// Stelle für ein fehlendes {% import %}: nach {% block content %}, sonst nach {% extends %}, sonst ganz oben
function importPosition(doc) {
    const text = doc.getText();
    const m = /\{%-?\s*block\s+content\s*-?%\}[^\n]*\n/.exec(text) || /\{%-?\s*extends\s[^%]*%\}[^\n]*\n/.exec(text);
    return doc.positionAt(m ? m.index + m[0].length : 0);
}

class Guide {
    constructor(env, features) {
        this.env = env;
        this.features = features;
        this.emitter = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.emitter.event;
        this.doc = null;            // smartVISU-Seite, auf die sich der Guide bezieht (zuletzt aktive)
        this.model = null;          // Promise<Modell | null>
        this.timer = null;
        this.last = { id: '', at: 0 };
        // Ziehen in den Editor
        this.dragMimeTypes = [MIME];
        this.dropMimeTypes = [];
    }

    // ------------------------------------------------------------------ Modell

    /** aktive Seite übernehmen (andere Dateien ändern nichts) */
    follow(ed) {
        if (!ed || ed.document === this.doc || !this.env.isCandidate(ed.document)) return;
        this.doc = ed.document;
        vscode.commands.executeCommand('setContext', 'smartvisu.guide.available', true);
        this.refresh(150);
    }

    refresh(delay = 300) {
        this.model = null;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.emitter.fire(), delay);
    }

    getModel() {
        if (!this.model) {
            this.model = this.build(this.doc).catch(e => {
                console.error('smartVISU guide:', e);
                return null;
            });
        }
        return this.model;
    }

    /**
     * @returns { c, entries: Map(id -> Eintrag), widgets: [Eintrag], snips, roots: [Knoten] } oder null
     *   Eintrag: { id, kind: 'widget', w, used, deprecated } | { id, kind: 'snippet', s }
     *   Knoten:  { type: 'search' } | { type: 'group', id, label, icon, children, description, expanded } | { type: 'entry', id, entry, short }
     */
    async build(doc) {
        if (!doc) return null;
        const c = await this.env.forDocument(doc);
        if (!c) return null;
        const stats = c.info.stats;
        const entries = new Map();
        const widgetEntry = (w) => {
            const id = 'w:' + w.name;
            if (!entries.has(id)) {
                entries.set(id, { id, kind: 'widget', w, used: stats.widgets.get(w.name) || 0, deprecated: w.deprecated !== undefined || c.view.deprecated.has(w.name) });
            }
            return entries.get(id);
        };
        // Reihenfolge wie in der Vorschlagsliste (häufig verwendete zuerst)
        const widgets = this.features.widgetOrder(c).map(widgetEntry);
        // Makrodateien im Seitenordner, die diese Seite (noch) nicht importiert – der Import wird beim Einfügen ergänzt
        const imported = new Set(twig.imports(doc.getText()).map(i => i.file));
        const own = path.basename(doc.fileName);
        for (const mf of c.info.macroFiles) {
            if (imported.has(mf.file) || mf.file === own) continue;
            const ws = await this.env.parseFile(vscode.Uri.joinPath(c.pagesDir, mf.file), mf.alias) || [];
            for (const w of ws) {
                if (!entries.has('w:' + w.name)) widgets.push(widgetEntry(Object.assign({}, w, { importFile: mf.file, importAlias: mf.alias })));
            }
        }
        const std = widgets.filter(e => e.w.origin !== 'custom');
        const custom = widgets.filter(e => e.w.origin === 'custom');
        const snips = this.features.snippetsFor(c, doc);
        for (const s of snips) entries.set('s:' + s.key, { id: 's:' + s.key, kind: 'snippet', s });

        const leaf = (gid, e, short) => ({ type: 'entry', id: gid + '/' + e.id, entry: e, short });
        const group = (id, label, ic, children, opts = {}) => ({ type: 'group', id, label, icon: ic, children, description: opts.description, expanded: !!opts.expanded });
        const byName = (list) => list.slice().sort((a, b) => a.deprecated - b.deprecated || a.w.name.localeCompare(b.w.name));
        const roots = [{ type: 'search', id: 'search' }];

        // Häufig verwendet (auf den eigenen Seiten)
        const freq = widgets.filter(e => e.used > 0).sort((a, b) => b.used - a.used).slice(0, FREQUENT);
        if (freq.length) {
            roots.push(group('frequent', t('guide.frequent'), ['star-full', 'charts.yellow'], freq.map(e => leaf('frequent', e, false)),
                { expanded: true, description: t('guide.frequentDesc') }));
        }

        // Code-Blöcke nach Zweck
        const placed = new Set();
        const cats = BLOCK_GROUPS.map(([gid, ic, keys]) => {
            const list = keys.filter(k => entries.has('s:' + k));
            list.forEach(k => placed.add(k));
            return { gid, ic, list };
        });
        cats[cats.length - 1].list.push(...snips.map(s => s.key).filter(k => !placed.has(k)));
        roots.push(group('blocks', t('guide.blocks'), 'code', cats.filter(g => g.list.length).map(g => group('blocks/' + g.gid, t('guide.cat.' + g.gid), g.ic,
            g.list.map(k => leaf('blocks/' + g.gid, entries.get('s:' + k), true)), { description: String(g.list.length) })),
        { expanded: true, description: String(snips.length) }));

        // smartVISU-Widgets nach Paket
        const byNs = new Map();
        for (const e of std) {
            if (!byNs.has(e.w.ns)) byNs.set(e.w.ns, []);
            byNs.get(e.w.ns).push(e);
        }
        const nsRank = (ns) => {
            const i = NS_ORDER.indexOf(ns);
            return i < 0 ? NS_ORDER.length : i;
        };
        const pkgs = [...byNs.keys()].sort((a, b) => nsRank(a) - nsRank(b) || a.localeCompare(b));
        roots.push(group('widgets', t('guide.widgets', c.catalog.version), 'library', pkgs.map(ns => {
            const list = byName(byNs.get(ns));
            return group('widgets/' + ns, ns, 'package', list.map(e => leaf('widgets/' + ns, e, true)),
                { description: [tOpt('guide.ns.' + ns), list.length].filter(Boolean).join(' · ') });
        }), { expanded: true, description: String(std.length) }));

        // eigene Widgets nach Datei
        if (custom.length) {
            const byFile = new Map();
            for (const e of custom) {
                const f = e.w.sourceName || e.w.ns + '.html';
                if (!byFile.has(f)) byFile.set(f, []);
                byFile.get(f).push(e);
            }
            roots.push(group('custom', t('guide.custom'), 'tools', [...byFile.keys()].sort().map(f => group('custom/' + f, f, 'file-code',
                byName(byFile.get(f)).map(e => leaf('custom/' + f, e, true)), { description: String(byFile.get(f).length) })),
            { expanded: true, description: String(custom.length) }));
        }
        if (this.view) this.view.description = 'smartVISU ' + c.catalog.version;
        return { c, entries, widgets, snips, roots };
    }

    // ------------------------------------------------------------------ TreeDataProvider

    async getChildren(node) {
        if (node) return node.children || [];
        const m = await this.getModel();
        return m ? m.roots : [];
    }

    getTreeItem(node) {
        const S = vscode.TreeItemCollapsibleState;
        let it;
        if (node.type === 'search') {
            it = new vscode.TreeItem(t('guide.search'), S.None);
            it.iconPath = icon('search');
            it.description = t('guide.searchDesc');
            it.tooltip = t('guide.searchTip');
            it.command = { command: 'smartvisu.guide.search', title: t('guide.search') };
            it.contextValue = 'search';
        } else if (node.type === 'group') {
            it = new vscode.TreeItem(node.label, node.expanded ? S.Expanded : S.Collapsed);
            it.iconPath = icon(node.icon);
            it.description = node.description;
            it.contextValue = 'group';
        } else {
            const e = node.entry;
            if (e.kind === 'snippet') {
                it = new vscode.TreeItem(e.s.desc, S.None);
                it.description = 'sv:' + e.s.key;
                it.iconPath = icon('symbol-snippet');
                it.contextValue = 'snippet';
            } else {
                const w = e.w;
                it = new vscode.TreeItem(node.short ? (w.macro || w.name) : w.name, S.None);
                it.description = [e.used ? e.used + '×' : '', e.deprecated ? '⚠ ' + t('widget.deprecatedTag') : '', w.importFile ? '+ import' : '', firstSentence(w.desc)]
                    .filter(Boolean).join(' · ');
                it.iconPath = icon(w.origin === 'custom' ? 'symbol-function' : 'symbol-method');
                it.contextValue = w.origin === 'custom' ? 'customWidget' : 'widget';
            }
            // kein Befehl beim Klick: Klick markiert nur – eingefügt wird mit ➕ (Inline-Knopf), Enter oder Ziehen
        }
        it.id = node.id;
        return it;
    }

    // Hilfe erst beim Überfahren mit der Maus: dieselbe wie in der Vorschlagsliste
    async resolveTreeItem(item, node) {
        if (!node || node.type !== 'entry') return item;
        const m = await this.getModel();
        if (!m) return item;
        const e = node.entry;
        let md;
        if (e.kind === 'widget') {
            md = widgetDoc(m.c, e.w);
            if (e.w.importFile) md.appendMarkdown('\n\n' + t('guide.importNote', e.w.importFile, e.w.importAlias));
        } else {
            md = snippetDoc(e.s, true);
        }
        md.supportThemeIcons = true;     // $(add) im Hinweis wie der Knopf
        md.appendMarkdown('\n\n---\n\n' + t('guide.hint'));
        item.tooltip = md;
        return item;
    }

    // ------------------------------------------------------------------ Einfügen

    // Eintrag aus Knoten (➕, Kontextmenü), Eintrag (Suche), ID (Ziehen) oder ohne Argument (Enter: markierter Knoten)
    async entryOf(arg) {
        if (!arg && this.view) arg = this.view.selection[0];
        if (!arg) return null;
        if (arg.entry) return arg.entry;
        if (arg.kind) return arg;
        const m = await this.getModel();
        return m && m.entries.get(String(arg));
    }

    // Editor, in den eingefügt wird: der aktive, wenn er eine smartVISU-Seite zeigt, sonst die Seite des Guides
    async targetEditor() {
        const a = vscode.window.activeTextEditor;
        let ed = a && this.env.isCandidate(a.document) ? a : vscode.window.visibleTextEditors.find(v => v.document === this.doc);
        if (ed) return vscode.window.showTextDocument(ed.document, { viewColumn: ed.viewColumn, preserveFocus: false });
        if (this.doc) return vscode.window.showTextDocument(this.doc.uri, { preview: false });
        return null;
    }

    /**
     * Text für einen Eintrag an einer Stelle: { body (Snippet), importLine?, importPos? }
     * Widgets außerhalb von {{ }} bekommen die Klammern; eigene Widgets ggf. den fehlenden {% import %}.
     */
    async insertion(e, doc, pos) {
        const c = await this.env.forDocument(doc);
        if (!c) return null;
        if (e.kind === 'snippet') {
            // für die Zielseite neu (Vorlagen je Dateiname, gelernte Werte)
            const s = this.features.snippetsFor(c, doc).find(x => x.key === e.s.key) || e.s;
            return { body: s.body };
        }
        const w = e.w;
        const out = {};
        // gelernte Parameter gelten für den Namen auf den Seiten – bei anderem Alias nur den Namen tauschen
        let body = callSnippet(w, { mode: cfg().get('insertParameters'), stats: c.info.stats }).body;
        if (w.importFile) {
            const im = twig.imports(doc.getText()).find(i => i.file === w.importFile);
            if (im) body = im.alias + '.' + w.macro + body.slice(w.name.length);
            else {
                out.importLine = `{% import "${w.importFile}" as ${w.importAlias} %}\n`;
                out.importPos = importPosition(doc);
            }
        }
        const x = twig.contextAt(doc.getText(), doc.offsetAt(pos));
        out.body = x.kind === 'expr' ? body : `{{ ${body} }}`;
        return out;
    }

    async insert(arg) {
        // Enter auf "Suchen …"
        if (!arg && this.view && this.view.selection[0] && this.view.selection[0].type === 'search') return this.search();
        const e = await this.entryOf(arg);
        if (!e) return;
        // Doppelklick fügt nicht zweimal ein
        const now = Date.now();
        if (this.last.id === e.id && now - this.last.at < 600) return;
        this.last = { id: e.id, at: now };
        const ed = await this.targetEditor();
        if (!ed) {
            vscode.window.showInformationMessage(t('guide.noEditor'));
            return;
        }
        const ins = await this.insertion(e, ed.document, ed.selection.active);
        if (!ins) {
            vscode.window.showInformationMessage(t('msg.noSmartVisu'));
            return;
        }
        // Import und Widget in einem Rückgängig-Schritt
        if (ins.importLine) await ed.edit(b => b.insert(ins.importPos, ins.importLine), { undoStopBefore: true, undoStopAfter: false });
        await ed.insertSnippet(new vscode.SnippetString(ins.body), undefined, { undoStopBefore: !ins.importLine, undoStopAfter: true });
        setTimeout(() => this.features.maybeTrigger(ed), 0);
    }

    async openDocs(arg) {
        const e = await this.entryOf(arg);
        if (!e || e.kind !== 'widget') return;
        const m = await this.getModel();
        const url = m && docuUrl(cfg().get('docuUrl'), m.c.catalog.version, e.w);
        if (url) return vscode.env.openExternal(vscode.Uri.parse(url));
        const line = e.w.line || 0;
        if (e.w.source) return vscode.window.showTextDocument(e.w.source, { selection: new vscode.Range(line, 0, line, 0) });
        return undefined;
    }

    // ------------------------------------------------------------------ Suche über alles

    async search() {
        this.follow(vscode.window.activeTextEditor);
        const m = await this.getModel();
        if (!m) {
            vscode.window.showInformationMessage(t('guide.noEditor'));
            return;
        }
        const items = [{ label: t('guide.widgetsShort'), kind: vscode.QuickPickItemKind.Separator }];
        for (const e of m.widgets) {
            const w = e.w;
            items.push({
                label: `$(${w.origin === 'custom' ? 'symbol-function' : 'symbol-method'}) ${w.name}`,
                description: [e.used ? e.used + '×' : '', e.deprecated ? '⚠ ' + t('widget.deprecatedTag') : '', firstSentence(w.desc)].filter(Boolean).join(' · '),
                entry: e,
            });
        }
        items.push({ label: t('guide.blocks'), kind: vscode.QuickPickItemKind.Separator });
        for (const s of m.snips) items.push({ label: `$(symbol-snippet) ${s.desc}`, description: 'sv:' + s.key, entry: m.entries.get('s:' + s.key) });
        const pick = await vscode.window.showQuickPick(items, {
            title: t('guide.searchTitle', m.c.catalog.version), placeHolder: t('guide.searchPlaceholder'), matchOnDescription: true,
        });
        if (pick && pick.entry) await this.insert(pick.entry);
    }

    // ------------------------------------------------------------------ Ziehen in den Editor

    handleDrag(source, dataTransfer) {
        const n = source.find(s => s.type === 'entry');
        if (n) dataTransfer.set(MIME, new vscode.DataTransferItem(n.entry.id));
    }

    async provideDocumentDropEdits(doc, pos, dataTransfer, token) {
        const item = dataTransfer.get(MIME);
        if (!item) return undefined;
        const e = await this.entryOf(await item.asString());
        if (!e || token.isCancellationRequested) return undefined;
        const ins = await this.insertion(e, doc, pos);
        if (!ins) return undefined;
        const edit = new vscode.DocumentDropEdit(new vscode.SnippetString(ins.body), t('guide.dropTitle'));
        if (ins.importLine) {
            const we = new vscode.WorkspaceEdit();
            we.insert(doc.uri, ins.importPos, ins.importLine);
            edit.additionalEdit = we;
        }
        return edit;
    }

    // ------------------------------------------------------------------ Registrierung

    register(context) {
        const dnd = typeof vscode.DataTransferItem === 'function';
        this.view = vscode.window.createTreeView(VIEW, { treeDataProvider: this, showCollapseAll: true, dragAndDropController: dnd ? this : undefined });
        context.subscriptions.push(
            this.view,
            this.emitter,
            vscode.commands.registerCommand('smartvisu.guide.insert', (n) => this.insert(n)),
            vscode.commands.registerCommand('smartvisu.guide.search', () => this.search()),
            vscode.commands.registerCommand('smartvisu.guide.openDocs', (n) => this.openDocs(n)),
            vscode.window.onDidChangeActiveTextEditor(ed => this.follow(ed)),
            this.env.onDidChange(() => this.refresh()),
            { dispose: () => clearTimeout(this.timer) },
        );
        if (dnd && typeof vscode.languages.registerDocumentDropEditProvider === 'function') {
            context.subscriptions.push(vscode.languages.registerDocumentDropEditProvider(SELECTOR, this, { dropMimeTypes: [MIME] }));
        }
        this.follow(vscode.window.activeTextEditor);
        if (!this.doc) this.follow(vscode.window.visibleTextEditors.find(v => this.env.isCandidate(v.document)));
    }
}

module.exports = { Guide, importPosition, BLOCK_GROUPS };
