'use strict';
// Test ohne VS Code: node test/smoke.js <seitenordner> [<smarthomeng-verzeichnis>] [--version 3.6]
// Liest alle Seiten, lernt die Nutzung, prüft jede Seite und zeigt Beispiele für Snippets und Item-Reihenfolge.

const fs = require('fs');
const path = require('path');
const i18n = require('../lib/i18n');
const twig = require('../lib/twig');
const { parseWidgets } = require('../lib/docblock');
const { Stats } = require('../lib/learn');
const { check } = require('../lib/check');
const { callSnippet, rankItems, suggestIds, fileTokens } = require('../lib/rank');
const { structureSnippets } = require('../lib/snippets');
const { Model } = require('../lib/shng/model');

i18n.setLanguage('de');
const args = process.argv.slice(2);
const vi = args.indexOf('--version');
const version = vi >= 0 ? args.splice(vi, 2)[1] : '3.6';
const [pagesDir, shngDir] = args;
if (!pagesDir) {
    console.error('Aufruf: node test/smoke.js <seitenordner> [<smarthomeng-verzeichnis>] [--version 3.6]');
    process.exit(1);
}

const data = require(`../data/widgets-${version}.json`);
const std = new Map(data.widgets.map(w => [w.name, Object.assign({ origin: 'std' }, w)]));
const install = path.resolve(pagesDir, '..', '..');

function customWidgets() {
    const out = new Map();
    for (const d of [path.join(install, 'dropins', 'shwidgets'), path.join(install, 'dropins', 'widgets'), path.join(pagesDir, 'widgets')]) {
        let files = [];
        try { files = fs.readdirSync(d).filter(f => f.endsWith('.html')); } catch { continue; }
        for (const f of files) for (const w of parseWidgets(fs.readFileSync(path.join(d, f), 'utf8'), f.slice(0, -5))) out.set(w.name, Object.assign(w, { origin: 'custom' }));
    }
    return out;
}
const custom = customWidgets();

function viewFor(text) {
    const extra = new Map(custom);
    for (const im of twig.imports(text)) {
        const f = path.join(pagesDir, im.file);
        if (fs.existsSync(f)) for (const w of parseWidgets(fs.readFileSync(f, 'utf8'), im.alias)) extra.set(w.name, Object.assign(w, { origin: 'custom' }));
    }
    return {
        version, removed: new Set(data.removed), deprecated: new Set(data.deprecated),
        namespaces: new Set([...data.widgets.map(w => w.ns), ...[...extra.values()].map(w => w.ns)]),
        get: (n) => extra.get(n) || std.get(n),
        all: () => [...std.values(), ...extra.values()],
    };
}

const adapter = {
    join: (base, ...p) => path.join(base, ...p),
    read: async (f) => fs.promises.readFile(f, 'utf8'),
    list: async (d) => { try { return (await fs.promises.readdir(d)).filter(n => n.endsWith('.yaml')).sort(); } catch { return []; } },
};

(async () => {
    let items = null;
    if (shngDir) {
        const m = await new Model(adapter, shngDir).load();
        items = new Map([...m.nodes()].map(n => [n.path, { path: n.path, type: String(n.attr('type') || ''), name: String(n.attr('name') || '') }]));
        console.log(`Items aus ${shngDir}: ${items.size}`);
    } else if (fs.existsSync(path.join(pagesDir, 'masteritem.json'))) {
        items = new Map(JSON.parse(fs.readFileSync(path.join(pagesDir, 'masteritem.json'), 'utf8')).map(e => {
            const [p, type] = e.split('|');
            return [p, { path: p, type, name: '' }];
        }));
        console.log(`Items aus masteritem.json: ${items.size}`);
    }

    const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));
    const stats = new Stats();
    for (const f of files) {
        const text = fs.readFileSync(path.join(pagesDir, f), 'utf8');
        const view = viewFor(text);
        stats.learnFile(text, n => view.get(n));
    }
    console.log(`\nGelernt aus ${stats.files} Dateien. Häufigste Widgets:`, [...stats.widgets].sort((a, b) => b[1] - a[1]).slice(0, 8));

    console.log('\n=== Prüfungen');
    for (const f of files) {
        const text = fs.readFileSync(path.join(pagesDir, f), 'utf8');
        const lineOf = twig.lineIndex(text);
        for (const d of check(text, viewFor(text), items)) console.log(`${f}:${lineOf(d.start) + 1}  ${d.severity.padEnd(7)} ${d.message}`);
    }

    console.log('\n=== Snippets für Widget-Aufrufe (learned)');
    for (const n of ['basic.flip', 'basic.print', 'device.dimmer', 'basic.stateswitch', 'device.uzsuicon', 'basic.slider', 'basic.symbol', 'plot.period']) {
        const w = std.get(n);
        if (w) console.log('  ', callSnippet(w, { mode: 'learned', stats }).body);
    }
    console.log('   (required):', callSnippet(std.get('device.dimmer'), { mode: 'required', stats }).body);

    console.log('\n=== Struktur-Snippets');
    const view = viewFor('');
    const snips = structureSnippets({ view, stats, mode: 'learned', version, templates: [...stats.templates.keys()], partials: ['navigation.html'], macroFiles: [{ file: 'selfDefined.html', alias: 'selfDefined' }] });
    console.log('  ', snips.map(s => s.key).join(', '));
    console.log(snips.find(s => s.key === 'block').body);
    console.log(snips.find(s => s.key === 'rowDimmer').body);
    console.log(snips.find(s => s.key === 'page').body.slice(0, 400));

    if (items) {
        console.log('\n=== Item-Reihenfolge: device.dimmer, 4. Parameter, nachdem der 3. ausgefüllt ist (rooms.og.kueche.html)');
        const text = "{{ device.dimmer('x', 'Esstisch', 'og.kueche.licht.esstisch.schalten', '') }}";
        const off = text.indexOf("'')") + 1;
        const x = twig.contextAt(text, off);
        const w = std.get('device.dimmer');
        const r = rankItems([...items.values()], { widget: w, param: w.params[x.argIndex], argIndex: x.argIndex, call: x.call, stats, tokens: fileTokens('rooms.og.kueche.html'), near: [] });
        r.slice(0, 8).forEach(e => console.log(`   ${e.score.toFixed(2)}  ${e.item.path} (${e.item.type})`));
        console.log('   IDs:', suggestIds(w, x.call, new Set(), fileTokens('rooms.og.kueche.html')).map(s => s.id).join(', '));

        console.log('\n=== Item-Reihenfolge: basic.flip, Item (rooms.eg.bad.html)');
        const t2 = "{{ basic.flip('', '') }}";
        const x2 = twig.contextAt(t2, t2.indexOf("'')") + 1);
        const w2 = std.get('basic.flip');
        rankItems([...items.values()], { widget: w2, param: w2.params[x2.argIndex], argIndex: x2.argIndex, call: x2.call, stats, tokens: fileTokens('rooms.eg.bad.html'), near: [] })
            .slice(0, 8).forEach(e => console.log(`   ${e.score.toFixed(2)}  ${e.item.path} (${e.item.type})`));
    }

    console.log('\n=== Kontext an Positionen');
    const sample = "<td>{{ basic.print('AbflussTemp', 'eg.bad.temp', '°') }}</td><td>{{ basic.stateswitch('a', 'b', 'icon', [1, 0], ['x.svg', 'y.svg']) }}</td>";
    for (const needle of ["eg.bad.t", "'°", "[1, ", "'y.s", 'basic.pr', '<td>']) {
        const off = sample.indexOf(needle) + needle.length;
        const x = twig.contextAt(sample, off);
        console.log(`   …${needle}| -> ${x.kind}${x.call ? ' ' + x.call.name + ' #' + x.argIndex : ''}${x.str ? ' im String' : ''}${x.inArray ? ' in Liste' : ''}`);
    }
})();
