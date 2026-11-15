'use strict';
// Umgebung einer smartVISU-Seite: Installation (version-info.php, config.ini), Widget-Version, Seitenordner,
// eigene Widgets (dropins/, pages/<name>/widgets/, {% import %}), Icons, Formate, gelernte Nutzung und Items.

const vscode = require('vscode');
const path = require('path');
const { parseWidgets, parseDeprecated } = require('./docblock');
const { Stats } = require('./learn');
const { imports, extendsOf } = require('./twig');
const { ItemStore, exists } = require('./items');

const BUNDLED = ['3.6', '3.5', '3.4', '3.3', '3.2', '3.1', '3.0', '2.9'];
const LANGS = new Set(['html', 'twig', 'jinja-html', 'django-html', 'nunjucks', 'jinja', 'twig-html']);
const FALLBACK_FORMATS = ['int', 'float', 'temp', '°', '°c', '%', '€', 'speed', 'v', 'a', 'w', 'kwh', 'date', 'time', 'short', 'long',
    'day', 'text', 'html', 'script'];

const dec = new TextDecoder('utf-8');
const base = (uri) => path.posix.basename(uri.path);
const parent = (uri) => vscode.Uri.joinPath(uri, '..');
const key = (uri) => String(uri).toLowerCase();

async function readText(uri) {
    return dec.decode(await vscode.workspace.fs.readFile(uri));
}
async function list(uri) {
    try {
        return await vscode.workspace.fs.readDirectory(uri);
    } catch {
        return [];
    }
}
async function mtime(uri) {
    try {
        return (await vscode.workspace.fs.stat(uri)).mtime;
    } catch {
        return null;
    }
}

function cmpVersion(a, b) {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
}

/** "3.6.0" -> "3.6"; unbekannte Versionen -> nächstältere mitgelieferte */
function bundledFor(v) {
    const [maj, min] = String(v).split('.');
    const k = `${maj}.${min}`;
    if (BUNDLED.includes(k)) return k;
    return BUNDLED.find(b => cmpVersion(b, k) <= 0) || BUNDLED[BUNDLED.length - 1];
}

function iniValue(text, name) {
    const m = new RegExp(`^\\s*${name}\\s*=\\s*"?([^"\\r\\n;]*)"?`, 'm').exec(text);
    return m ? m[1].trim() : '';
}

class Catalog {
    constructor(data, origin) {
        this.version = data.version;
        this.tag = data.tag || '';
        this.widgets = new Map();
        this.namespaces = new Set();
        this.removed = new Set(data.removed || []);
        this.deprecated = new Set(data.deprecated || []);
        this.icons = data.icons || [];
        for (const w of data.widgets) this.add(Object.assign({}, w, { origin }));
    }
    add(w) {
        this.widgets.set(w.name, w);
        this.namespaces.add(w.ns);
    }
}

class Env {
    constructor() {
        this.items = new ItemStore();
        this.installs = new Map();   // Ordner -> Promise<Installation|null>
        this.catalogs = new Map();   // Version/Installation -> Promise<Catalog>
        this.customs = new Map();    // Installation|Seitenordner -> Promise<[Widget]>
        this.parsed = new Map();     // Datei -> { mtime, widgets }
        this.learned = new Map();    // Seitenordner|Version -> Promise<Seiteninfo>
        this.iconLists = new Map();
        this.formatLists = new Map();
        this.changed = new vscode.EventEmitter();
        this.onDidChange = this.changed.event;
        this.items.onDidChange(() => this.changed.fire());
    }

    clear() {
        this.installs.clear();
        this.catalogs.clear();
        this.customs.clear();
        this.parsed.clear();
        this.learned.clear();
        this.iconLists.clear();
        this.formatLists.clear();
        this.items.invalidate();
        this.changed.fire();
    }

    // eine HTML-Datei wurde gespeichert: betroffene Zwischenspeicher verwerfen
    fileSaved(uri) {
        const u = key(uri);
        if (!u.endsWith('.html')) return;
        for (const k of [...this.learned.keys()]) if (u.startsWith(k.split('|')[0])) this.learned.delete(k);
        for (const k of [...this.customs.keys()]) if (k.split('|').some(p => p && u.startsWith(p))) this.customs.delete(k);
        for (const k of [...this.parsed.keys()]) if (k.startsWith(u + '|')) this.parsed.delete(k);
        this.changed.fire();
    }

    isCandidate(doc) {
        if (!LANGS.has(doc.languageId)) return false;
        const p = doc.uri.path.toLowerCase();
        if (/\/(pages|dropins|widgets)\//.test(p)) return true;
        return /\{\{|\{%/.test(doc.getText().slice(0, 50000));
    }

    // ---------------------------------------------------------------- Installation

    async installFor(uri) {
        const configured = vscode.workspace.getConfiguration('smartvisu').get('installPath');
        if (configured) return this.install(vscode.Uri.file(configured));
        let dir = parent(uri);
        for (let i = 0; i < 6; i++) {
            const k = key(dir);
            if (!this.installs.has(k)) {
                this.installs.set(k, (async () => {
                    if (await exists(vscode.Uri.joinPath(dir, 'version-info.php')) && await exists(vscode.Uri.joinPath(dir, 'widgets'))) return this.install(dir);
                    return null;
                })());
            }
            const found = await this.installs.get(k);
            if (found) return found;
            const up = parent(dir);
            if (up.path === dir.path) break;
            dir = up;
        }
        return null;
    }

    async install(root) {
        const k = 'root|' + key(root);
        if (!this.installs.has(k)) {
            this.installs.set(k, (async () => {
                let version = '';
                try {
                    const v = await readText(vscode.Uri.joinPath(root, 'version-info.php'));
                    const g = (n) => (new RegExp(`config_version_${n}'\\s*,\\s*'([^']*)'`).exec(v) || [])[1];
                    version = [g('major'), g('minor'), g('revision')].filter(x => x !== undefined).join('.');
                } catch { /* keine Versionsdatei */ }
                let pages = '', lang = '';
                try {
                    const ini = await readText(vscode.Uri.joinPath(root, 'config.ini'));
                    pages = iniValue(ini, 'pages');
                    lang = iniValue(ini, 'lang');
                } catch { /* ohne config.ini */ }
                if (!version && !(await exists(vscode.Uri.joinPath(root, 'widgets')))) return null;
                return { root, version, pages, lang };
            })());
        }
        return this.installs.get(k);
    }

    // Seitenordner: der Ordner direkt unter pages/, sonst der aus config.ini, sonst der Ordner der Datei
    pagesDirFor(uri, inst) {
        let dir = parent(uri);
        for (let i = 0; i < 5; i++) {
            const up = parent(dir);
            if (base(up).toLowerCase() === 'pages') return dir;
            if (up.path === dir.path) break;
            dir = up;
        }
        if (inst && inst.pages) return vscode.Uri.joinPath(inst.root, 'pages', inst.pages);
        return parent(uri);
    }

    // ---------------------------------------------------------------- Widgets

    /** gewählte Version: { version, source: 'setting'|'install'|'default'|'installed' } */
    versionFor(inst) {
        const v = vscode.workspace.getConfiguration('smartvisu').get('version') || 'auto';
        if (v === 'installed' && inst) return { version: inst.version || '?', source: 'installed' };
        if (v !== 'auto' && v !== 'installed') return { version: v, source: 'setting' };
        if (inst && inst.version) return { version: bundledFor(inst.version), source: 'install' };
        return { version: BUNDLED[0], source: 'default' };
    }

    async catalog(sel, inst) {
        const k = sel.source === 'installed' ? 'inst|' + key(inst.root) : 'v|' + sel.version;
        if (!this.catalogs.has(k)) {
            this.catalogs.set(k, (async () => {
                if (sel.source !== 'installed') {
                    const v = BUNDLED.includes(sel.version) ? sel.version : BUNDLED[0];
                    return new Catalog(require(path.join(__dirname, '..', 'data', `widgets-${v}.json`)), 'std');
                }
                // Widgets direkt aus der Installation lesen
                const wdir = vscode.Uri.joinPath(inst.root, 'widgets');
                const data = { version: inst.version, tag: 'installation', widgets: [], removed: [], deprecated: [], icons: [] };
                for (const [n, ft] of await list(wdir)) {
                    if (!(ft & vscode.FileType.File)) continue;
                    if (n.endsWith('.html')) {
                        const f = vscode.Uri.joinPath(wdir, n);
                        for (const w of parseWidgets(await readText(f), n.slice(0, -5))) data.widgets.push(Object.assign(w, { file: 'widgets/' + n }));
                    } else if (n === 'deprecated.yaml') {
                        Object.assign(data, parseDeprecated(await readText(vscode.Uri.joinPath(wdir, n))));
                    }
                }
                return new Catalog(data, 'std');
            })());
        }
        return this.catalogs.get(k);
    }

    async parseFile(uri, ns) {
        const k = key(uri) + '|' + ns;
        const c = this.parsed.get(k);
        // Änderungszeit höchstens alle 5 s prüfen (Netzlaufwerk); gespeicherte Dateien verwirft fileSaved()
        if (c && Date.now() - c.checked < 5000) return c.widgets;
        const m = await mtime(uri);
        if (m === null) {
            this.parsed.set(k, { mtime: null, widgets: null, checked: Date.now() });
            return null;
        }
        if (c && c.mtime === m) {
            c.checked = Date.now();
            return c.widgets;
        }
        let widgets = [];
        try {
            widgets = parseWidgets(await readText(uri), ns).map(w => Object.assign(w, { origin: 'custom', source: uri, sourceName: base(uri) }));
        } catch { /* nicht lesbar */ }
        this.parsed.set(k, { mtime: m, widgets, checked: Date.now() });
        return widgets;
    }

    // eigene Widgets, die smartVISU automatisch importiert (dropins/shwidgets, dropins/widgets, pages/<name>/widgets)
    async customWidgets(inst, pagesDir) {
        const dirs = [];
        if (inst) dirs.push(vscode.Uri.joinPath(inst.root, 'dropins', 'shwidgets'), vscode.Uri.joinPath(inst.root, 'dropins', 'widgets'));
        if (pagesDir) dirs.push(vscode.Uri.joinPath(pagesDir, 'widgets'));
        const k = dirs.map(key).join('|');
        if (!this.customs.has(k)) {
            this.customs.set(k, (async () => {
                const out = [];
                for (const d of dirs) {
                    for (const [n, ft] of await list(d)) {
                        if ((ft & vscode.FileType.File) && /^[A-Za-z_][\w]*\.html$/.test(n)) out.push(...(await this.parseFile(vscode.Uri.joinPath(d, n), n.slice(0, -5)) || []));
                    }
                }
                return out;
            })());
        }
        return this.customs.get(k);
    }

    // Kandidaten für {% import "datei" %} / {% include %} (Twig-Suchpfade von smartVISU)
    importCandidates(file, inst, pagesDir) {
        if (file.startsWith('@widgets/')) {
            const rest = file.slice(9);
            const out = [];
            if (inst) out.push(vscode.Uri.joinPath(inst.root, 'widgets', rest), vscode.Uri.joinPath(inst.root, 'dropins', rest),
                vscode.Uri.joinPath(inst.root, 'dropins', 'widgets', rest), vscode.Uri.joinPath(inst.root, 'dropins', 'shwidgets', rest));
            if (pagesDir) out.push(vscode.Uri.joinPath(pagesDir, 'widgets', rest));
            return out;
        }
        const out = [];
        if (pagesDir) out.push(vscode.Uri.joinPath(pagesDir, file));
        if (inst) out.push(vscode.Uri.joinPath(inst.root, 'pages', 'base', file), vscode.Uri.joinPath(inst.root, 'widgets', file),
            vscode.Uri.joinPath(inst.root, 'dropins', file));
        return out;
    }

    /**
     * Widgets aus den {% import %}-Anweisungen eines Textes.
     * @returns { widgets: [Widget], aliases: Map(alias -> Namensraum), missing: Set(datei) }
     */
    async importsOf(text, inst, pagesDir, cat) {
        const widgets = [];
        const aliases = new Map();
        const missing = new Set();
        for (const im of imports(text)) {
            const stdNs = path.posix.basename(im.file).replace(/\.html$/, '');
            if (cat.namespaces.has(stdNs) && (im.file.startsWith('@widgets/') || im.file === stdNs + '.html')) {
                if (im.alias !== stdNs) aliases.set(im.alias, stdNs);
                continue;
            }
            let found = null;
            for (const c of this.importCandidates(im.file, inst, pagesDir)) {
                const ws = await this.parseFile(c, im.alias);
                if (ws) { found = ws; break; }
            }
            if (found) widgets.push(...found);
            else missing.add(im.file);
        }
        return { widgets, aliases, missing };
    }

    // ---------------------------------------------------------------- Seitenordner (Lernen, Seiten, Vorlagen)

    async pagesInfo(pagesDir, inst, cat, custom) {
        const k = key(pagesDir) + '|' + cat.version + '|' + cat.tag;
        if (!this.learned.has(k)) {
            this.learned.set(k, (async () => {
                const stats = new Stats();
                const pages = [], partials = [], macroFiles = [];
                const byPrefix = new Map();   // "rooms" -> Map(Vorlage -> Anzahl)
                const walk = async (dir, rel, depth) => {
                    for (const [n, ft] of await list(dir)) {
                        const u = vscode.Uri.joinPath(dir, n);
                        if ((ft & vscode.FileType.Directory) && depth < 2 && !/^(pics|widgets|\.git|node_modules)$/i.test(n)) await walk(u, rel + n + '/', depth + 1);
                        if (!(ft & vscode.FileType.File) || !n.endsWith('.html')) continue;
                        let text;
                        try { text = await readText(u); } catch { continue; }
                        const name = rel + n.slice(0, -5);
                        pages.push(name);
                        const ext = extendsOf(text);
                        if (ext) {
                            const pre = rel + n.split('.')[0];
                            if (!byPrefix.has(pre)) byPrefix.set(pre, new Map());
                            byPrefix.get(pre).set(ext, (byPrefix.get(pre).get(ext) || 0) + 1);
                        }
                        const hasMacro = /\{%-?\s*macro\s/.test(text);
                        if (hasMacro && !rel) macroFiles.push({ file: n, alias: n.slice(0, -5) });
                        if (!hasMacro && !extendsOf(text) && !rel) partials.push(n);
                        const imp = await this.importsOf(text, inst, pagesDir, cat);
                        const byName = new Map(custom.map(w => [w.name, w]));
                        for (const w of imp.widgets) byName.set(w.name, w);
                        stats.learnFile(text, (name) => {
                            const [ns, ...r] = name.split('.');
                            const real = imp.aliases.has(ns) ? imp.aliases.get(ns) + '.' + r.join('.') : name;
                            return byName.get(real) || cat.widgets.get(real);
                        });
                    }
                };
                await walk(pagesDir, '', 0);
                // Alias aus den Seiten übernehmen ({% import "selfDefined.html" as selfDefined %})
                for (const mf of macroFiles) {
                    for (const [fa] of stats.importFiles) {
                        const [f, a] = fa.split('|');
                        if (f === mf.file) mf.alias = a;
                    }
                }
                const templates = [...stats.templates].sort((a, b) => b[1] - a[1]).map(([f]) => f);
                if (!templates.includes('base.html')) templates.push('base.html');
                // Seiten im Ordner selbst zuerst, dann die in Unterordnern
                pages.sort((a, b) => a.includes('/') - b.includes('/') || a.localeCompare(b));
                // Vorlagen für eine Datei: zuerst die, die Dateien mit gleichem Präfix (rooms.…) erben
                const templatesFor = (fileName) => {
                    const m = byPrefix.get(path.posix.basename(String(fileName).replace(/\\/g, '/')).split('.')[0]);
                    if (!m) return templates;
                    const first = [...m].sort((a, b) => b[1] - a[1]).map(([f]) => f);
                    return [...new Set([...first, ...templates])];
                };
                return { stats, pages, partials: partials.sort(), macroFiles, templates, templatesFor };
            })());
        }
        return this.learned.get(k);
    }

    async icons(inst, cat) {
        if (!inst) return cat.icons;
        const k = key(inst.root);
        if (!this.iconLists.has(k)) {
            this.iconLists.set(k, (async () => {
                const names = new Set();
                for (const d of [['icons', 'ws'], ['dropins', 'icons', 'ws']]) {
                    for (const [n] of await list(vscode.Uri.joinPath(inst.root, ...d))) if (/\.svg$/i.test(n)) names.add(n.slice(0, -4));
                }
                return names.size ? [...names].sort() : cat.icons;
            })());
        }
        return this.iconLists.get(k);
    }

    async formats(inst) {
        if (!inst) return FALLBACK_FORMATS;
        const k = key(inst.root);
        if (!this.formatLists.has(k)) {
            this.formatLists.set(k, (async () => {
                const lang = inst.lang || 'de';
                const out = new Map();
                for (const f of [['lang', lang + '.ini'], ['dropins', 'lang', lang + '.ini']]) {
                    let text;
                    try { text = await readText(vscode.Uri.joinPath(inst.root, ...f)); } catch { continue; }
                    const sect = /^\[format\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text);
                    if (!sect) continue;
                    for (const m of sect[1].matchAll(/^\s*([^;=\s][^=]*?)\s*=\s*"?([^"\r\n]*)"?/gm)) out.set(m[1], m[2]);
                }
                return out.size ? [...out.keys()] : FALLBACK_FORMATS;
            })());
        }
        return this.formatLists.get(k);
    }

    // ---------------------------------------------------------------- alles für ein Dokument

    /**
     * @returns null (keine smartVISU-Seite) oder
     *   { install, pagesDir, sel, catalog, view, info (stats, pages, partials, macroFiles, templates), items, missingImports }
     */
    async forDocument(doc) {
        if (!this.isCandidate(doc)) return null;
        const inst = await this.installFor(doc.uri);
        const pagesDir = this.pagesDirFor(doc.uri, inst);
        const sel = this.versionFor(inst);
        const cat = await this.catalog(sel, inst);
        const custom = await this.customWidgets(inst, pagesDir);
        const imp = await this.importsOf(doc.getText(), inst, pagesDir, cat);
        const info = await this.pagesInfo(pagesDir, inst, cat, custom);
        await this.items.ensure(pagesDir);

        const extra = new Map();
        for (const w of custom) extra.set(w.name, w);
        for (const w of imp.widgets) extra.set(w.name, w);
        const namespaces = new Set([...cat.namespaces, ...[...extra.values()].map(w => w.ns), ...imp.aliases.keys()]);
        const view = {
            version: cat.version,
            removed: cat.removed,
            deprecated: cat.deprecated,
            namespaces,
            get(name) {
                if (extra.has(name)) return extra.get(name);
                const [ns, ...r] = name.split('.');
                if (imp.aliases.has(ns)) return cat.widgets.get(imp.aliases.get(ns) + '.' + r.join('.'));
                return cat.widgets.get(name);
            },
            all() {
                return [...cat.widgets.values(), ...extra.values()];
            },
        };
        return { install: inst, pagesDir, sel, catalog: cat, view, info, items: this.items, missingImports: imp.missing, env: this };
    }

    dispose() {
        this.items.dispose();
        this.changed.dispose();
    }
}

module.exports = { Env, BUNDLED, bundledFor, cmpVersion };
