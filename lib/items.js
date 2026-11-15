'use strict';
// SmartHomeNG-Items als Quelle für die Vorschläge:
//  - "path":       SmartHomeNG-Verzeichnis aus smartvisu.items.path (items/, structs/, etc/ – Structs werden aufgelöst)
//  - "shngItems":  dasselbe Verzeichnis und Modell wie die Erweiterung "SmartHomeNG Items" (dasax.shng-items)
//  - "masteritem": masteritem.json im Seitenordner (schreibt das SmartHomeNG-Plugin smartvisu; nur Pfad und Typ)
//  - "auto":       path, sonst shngItems, sonst masteritem

const vscode = require('vscode');
const path = require('path');
const { t } = require('./i18n');

const SHNG_EXT = 'dasax.shng-items';

const fsAdapter = {
    join: (base, ...parts) => vscode.Uri.joinPath(base, ...parts),
    read: async (uri) => new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri)),
    list: async (uri) => {
        try {
            const entries = await vscode.workspace.fs.readDirectory(uri);
            return entries.filter(([n, ft]) => (ft & vscode.FileType.File) && n.endsWith('.yaml')).map(([n]) => n).sort();
        } catch {
            return [];
        }
    },
};

async function exists(uri) {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

const fmt = (v) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v));

class ItemStore {
    constructor() {
        this.items = new Map();       // Pfad -> { path, type, name, struct, node }
        this.key = null;              // geladene Quelle
        this.kind = 'none';
        this.label = '';
        this.error = null;
        this.loading = null;
        this.watchers = [];
        this.changed = new vscode.EventEmitter();
        this.onDidChange = this.changed.event;
        this.reloadTimer = null;
    }

    shngExtension() {
        return vscode.extensions.getExtension(SHNG_EXT);
    }

    // Basisverzeichnis wie in "SmartHomeNG Items": shngItems.basePath oder Workspace-Ordner mit items/
    async shngBase() {
        if (!this.shngExtension()) return null;
        const configured = vscode.workspace.getConfiguration('shngItems').get('basePath');
        const candidates = configured ? [vscode.Uri.file(configured)] : (vscode.workspace.workspaceFolders || []).map(f => f.uri);
        for (const uri of candidates) if (await exists(vscode.Uri.joinPath(uri, 'items'))) return uri;
        return null;
    }

    async pathBase() {
        const p = vscode.workspace.getConfiguration('smartvisu').get('items.path');
        if (!p) return null;
        const uri = vscode.Uri.file(p);
        if (await exists(vscode.Uri.joinPath(uri, 'items'))) return uri;
        if (path.basename(p).toLowerCase() === 'items' && await exists(uri)) return vscode.Uri.joinPath(uri, '..');
        return null;
    }

    async resolve(pagesDir) {
        const cfg = vscode.workspace.getConfiguration('smartvisu');
        const mode = cfg.get('items.source') || 'auto';
        const master = async () => {
            if (!pagesDir) return null;
            const u = vscode.Uri.joinPath(pagesDir, 'masteritem.json');
            return (await exists(u)) ? u : null;
        };
        if (mode === 'none') return { kind: 'none' };
        if (mode === 'path') {
            const b = await this.pathBase();
            return b ? { kind: 'path', base: b } : { kind: 'none', error: t('items.pathInvalid', cfg.get('items.path') || '') };
        }
        if (mode === 'shngItems') {
            const b = await this.shngBase();
            if (b) return { kind: 'shngItems', base: b };
            return { kind: 'none', error: this.shngExtension() ? t('items.shngNoBase') : t('items.shngMissing') };
        }
        if (mode === 'masteritem') {
            const m = await master();
            return m ? { kind: 'masteritem', file: m } : { kind: 'none', error: t('items.noMaster') };
        }
        // auto
        let b = await this.pathBase();
        if (b) return { kind: 'path', base: b };
        b = await this.shngBase();
        if (b) return { kind: 'shngItems', base: b };
        const m = await master();
        if (m) return { kind: 'masteritem', file: m };
        return { kind: 'none' };
    }

    /** Items für den Seitenordner bereitstellen (lädt nur, wenn sich die Quelle geändert hat) */
    async ensure(pagesDir) {
        const want = String(pagesDir || '');
        if (this.key && this.resolvedFor === want) return this;
        if (this.loading) return this.loading;
        this.loading = (async () => {
            try {
                const src = await this.resolve(pagesDir);
                const key = src.kind + '|' + String(src.base || src.file || '') + '|' + (src.error || '');
                this.resolvedFor = want;
                if (key === this.key) return this;
                this.key = key;
                await this.load(src);
            } finally {
                this.loading = null;
            }
            return this;
        })();
        return this.loading;
    }

    invalidate() {
        this.key = null;
    }

    async load(src) {
        this.items = new Map();
        this.model = null;
        this.kind = src.kind;
        this.error = src.error || null;
        this.label = '';
        this.watch(src);
        try {
            if (src.kind === 'path' || src.kind === 'shngItems') {
                let Model = require('./shng/model').Model;
                if (src.kind === 'shngItems') {
                    // Modell der installierten Erweiterung verwenden (gleicher Stand wie deren Item-Baum)
                    try {
                        Model = require(path.join(this.shngExtension().extensionPath, 'lib', 'model.js')).Model;
                    } catch { /* ältere Version ohne lib/model.js: eigene Kopie */ }
                }
                const model = await new Model(fsAdapter, src.base).load();
                this.model = model;
                for (const node of model.nodes()) {
                    this.items.set(node.path, {
                        path: node.path,
                        type: fmt(node.attr('type')),
                        name: fmt(node.attr('name')),
                        struct: node.fromStruct || '',
                        acl: fmt(node.attr('visu_acl')),
                        node,
                    });
                }
                if (model.errors.length) this.error = model.errors[0];
                this.label = (src.kind === 'shngItems' ? t('items.labelShng') : t('items.labelPath')) + ' ' + src.base.fsPath;
            } else if (src.kind === 'masteritem') {
                const list = JSON.parse(await fsAdapter.read(src.file));
                for (const e of list) {
                    const [p, type] = String(e).split('|');
                    if (p) this.items.set(p, { path: p, type: type || '', name: '', struct: '' });
                }
                this.label = t('items.labelMaster') + ' ' + src.file.fsPath;
            }
        } catch (e) {
            this.error = e.message;
        }
        this.changed.fire();
    }

    scheduleReload() {
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => {
            this.invalidate();
            this.changed.fire();
        }, 500);
    }

    watch(src) {
        this.watchers.forEach(w => w.dispose());
        this.watchers = [];
        let pattern = null;
        if (src.base) pattern = new vscode.RelativePattern(src.base, '{items,structs,etc}/*.yaml');
        else if (src.file) pattern = new vscode.RelativePattern(vscode.Uri.joinPath(src.file, '..'), 'masteritem.json');
        if (!pattern) return;
        const w = vscode.workspace.createFileSystemWatcher(pattern);
        w.onDidChange(() => this.scheduleReload());
        w.onDidCreate(() => this.scheduleReload());
        w.onDidDelete(() => this.scheduleReload());
        this.watchers.push(w);
        // Netzlaufwerke melden Änderungen nicht immer – deshalb zusätzlich beim Speichern
        this.watchers.push(vscode.workspace.onDidSaveTextDocument(doc => {
            const root = String(src.base || vscode.Uri.joinPath(src.file, '..')).toLowerCase();
            const u = String(doc.uri).toLowerCase();
            if (u.startsWith(root) && (u.endsWith('.yaml') || u.endsWith('masteritem.json'))) this.scheduleReload();
        }));
    }

    dispose() {
        this.watchers.forEach(w => w.dispose());
        this.changed.dispose();
    }
}

module.exports = { ItemStore, SHNG_EXT, exists };
