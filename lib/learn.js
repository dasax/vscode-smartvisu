'use strict';
// Lernt aus den vorhandenen Seiten im Seitenordner (pages/<name>/), wie Widgets dort benutzt werden:
//  - wie oft welches Widget vorkommt und mit wie vielen Parametern
//  - welche Werte für Parameter von Hand eingetragen wurden (z.B. 'icon', [1, 0], '#25ea4e', '°')
//  - welche Item-Endungen ein Item-Parameter typischerweise bekommt (device.dimmer: …schalten / …dimmen)
//  - ob die Items eines Aufrufs Geschwister sind (gleiches Eltern-Item)
//  - Kopfkommentar, Vorlagen ({% extends %}) und importierte Makro-Dateien
// Ohne VS-Code-Abhängigkeit.

const { allCalls, extendsOf, imports } = require('./twig');

const PATH_RE = /^[A-Za-z_][\w-]*(\.[\w-]+)+$/;

function isItemParam(p) {
    if (!p) return false;
    if (p.type) return p.type === 'item';
    return /\bitem|\bgad\b|^g_|^item/i.test(p.name) || /\bitem\b|\bgad\b/i.test(p.desc || '');
}

function bump(map, key, n = 1) {
    map.set(key, (map.get(key) || 0) + n);
}

function parentOf(path) {
    const i = path.lastIndexOf('.');
    return i > 0 ? path.slice(0, i) : '';
}

function lastSeg(path) {
    return path.slice(path.lastIndexOf('.') + 1);
}

/** Item-Pfade aus einem Argument-Literal (String oder Liste von Strings) */
function pathsOf(lit) {
    if (!lit) return [];
    if (lit.kind === 'string') return PATH_RE.test(lit.value) ? [lit.value] : [];
    if (lit.kind === 'array') return lit.items.flatMap(pathsOf);
    return [];
}

class Stats {
    constructor() {
        this.widgets = new Map();      // Widget -> Anzahl
        this.argCounts = new Map();    // Widget -> Map(Anzahl Parameter -> Häufigkeit)
        this.values = new Map();       // "widget#i" -> Map(Literal -> Anzahl)
        this.lastSegs = new Map();     // "widget#i" -> Map(Item-Endung -> Anzahl)
        this.paths = new Map();        // "widget#i" -> Map(Item-Pfad -> Anzahl) – daraus die verwendeten Item-Typen
        this.siblings = new Map();     // "widget#i#j" -> { same, total }
        this.headers = new Map();      // Kopfkommentar -> Anzahl
        this.templates = new Map();    // {% extends %}-Ziel -> Anzahl
        this.importFiles = new Map();  // "datei|alias" -> Anzahl
        this.files = 0;
    }

    learnFile(text, lookup) {
        this.files++;
        const head = /^\s*(\/\*\*[\s\S]*?\*\/)/.exec(text);
        if (head && head[1].includes('@')) bump(this.headers, head[1]);
        const ext = extendsOf(text);
        if (ext) bump(this.templates, ext);
        for (const im of imports(text)) bump(this.importFiles, `${im.file}|${im.alias}`);

        for (const call of allCalls(text)) {
            const w = lookup(call.name);
            if (!w) continue;
            bump(this.widgets, w.name);
            if (!this.argCounts.has(w.name)) this.argCounts.set(w.name, new Map());
            bump(this.argCounts.get(w.name), call.args.length);
            const itemArgs = [];
            call.args.forEach((a, i) => {
                const p = w.params[i];
                if (!p) return;
                const key = `${w.name}#${i}`;
                if (isItemParam(p)) {
                    const paths = pathsOf(a);
                    if (paths.length) {
                        if (!this.lastSegs.has(key)) this.lastSegs.set(key, new Map());
                        if (!this.paths.has(key)) this.paths.set(key, new Map());
                        for (const path of paths) {
                            bump(this.lastSegs.get(key), lastSeg(path));
                            bump(this.paths.get(key), path);
                        }
                        itemArgs.push({ i, path: paths[0] });
                    }
                } else if (a.kind !== 'expr' && a.raw !== '' && a.raw !== "''" && a.raw !== '""' && p.type !== 'id') {
                    if (!this.values.has(key)) this.values.set(key, new Map());
                    bump(this.values.get(key), normalize(a.raw));
                }
            });
            for (const x of itemArgs) {
                for (const y of itemArgs) {
                    if (x === y) continue;
                    const key = `${w.name}#${y.i}#${x.i}`;
                    const s = this.siblings.get(key) || { same: 0, total: 0 };
                    s.total++;
                    if (parentOf(x.path) === parentOf(y.path)) s.same++;
                    this.siblings.set(key, s);
                }
            }
        }
    }

    /** Typen der Items, die auf den Seiten für Parameter i verwendet werden: Set (leer, wenn unbekannt) */
    itemTypesFor(name, i, items) {
        const out = new Set();
        const m = this.paths.get(`${name}#${i}`);
        if (m && items) for (const p of m.keys()) {
            const it = items.get(p);
            if (it && it.type) out.add(it.type);
        }
        return out;
    }

    /** häufigste Parameterzahl eines Widgets (oder 0) */
    usualArgCount(name) {
        const m = this.argCounts.get(name);
        if (!m) return 0;
        let best = 0, n = 0;
        for (const [k, v] of m) if (v > n || (v === n && k > best)) { best = k; n = v; }
        return best;
    }

    /** gelernte Werte für Parameter i: [{ raw, count }] absteigend */
    valuesFor(name, i) {
        const m = this.values.get(`${name}#${i}`);
        return m ? [...m].map(([raw, count]) => ({ raw, count })).sort((a, b) => b.count - a.count) : [];
    }

    /** häufigster Wert, wenn er in mindestens share der Fälle vorkommt */
    typicalValue(name, i, share = 0.4) {
        const list = this.valuesFor(name, i);
        const total = list.reduce((s, v) => s + v.count, 0);
        return list.length && list[0].count / total >= share && list[0].count >= 2 ? list[0].raw : null;
    }

    header() {
        let best = null, n = 0;
        for (const [h, c] of this.headers) if (c > n) { best = h; n = c; }
        return best;
    }
}

// Leerraum in Listen vereinheitlichen, damit [1,0] und [1, 0] zusammengezählt werden
// (außerhalb von Strings: Leerraum entfernen, nach jedem Komma genau ein Leerzeichen)
function normalize(raw) {
    let out = '';
    let q = null;
    for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (q) {
            out += c;
            if (c === '\\') out += raw[++i] || '';
            else if (c === q) q = null;
        } else if (c === "'" || c === '"') {
            q = c;
            out += c;
        } else if (c === ',') out += ', ';
        else if (!/\s/.test(c)) out += c;
    }
    return out.trim();
}

module.exports = { Stats, isItemParam, pathsOf, parentOf, lastSeg, normalize, PATH_RE };
