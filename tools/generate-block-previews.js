'use strict';
// Vorschaubilder der Code-Blöcke (sv:…) für Guide und Vorschlagsliste: jeden Block mit Beispielinhalt füllen, als Seite
// in einem temporären Seitenordner der eigenen smartVISU-Installation ablegen (Offline-Treiber, Design der Installation,
// visu.css eines Seitenordners), mit Edge/Chrome im Headless-Modus ausschneiden und den Seitenordner wieder löschen.
//
//   node tools/generate-block-previews.js --install <smartvisu-ordner> --url <smartvisu-url> [--style ksh] [--keep] [block ...]
//   z.B. --install //smarthomeng/smartvisu --url http://smarthomeng/smartvisu --style ksh
//
// Ergebnis: media/previews/blocks/<block>.png und media/previews/blocks/index.json ({ block: { w, h } })

const fs = require('fs');
const path = require('path');
const { launch } = require('./cdp');
const i18n = require('../lib/i18n');
i18n.setLanguage('de');
const { structureSnippets } = require('../lib/snippets');

const args = process.argv.slice(2);
const opt = (name, def) => {
    const i = args.indexOf(name);
    if (i < 0) return def;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
};
const install = opt('--install');
const url = String(opt('--url', '')).replace(/\/$/, '');
const style = opt('--style', '');
const keep = args.includes('--keep');
const only = args.filter(a => !a.startsWith('--'));
if (!install || !url) {
    console.log('Aufruf: node tools/generate-block-previews.js --install <smartvisu-ordner> --url <smartvisu-url> [--style <seitenordner>] [--keep] [block ...]');
    process.exit(1);
}

const PAGES = '_svpreview';
const pagesDir = path.join(install, 'pages', PAGES);
const tempDir = path.join(install, 'temp');
const outDir = path.join(__dirname, '..', 'media', 'previews', 'blocks');
fs.mkdirSync(outDir, { recursive: true });
const indexFile = path.join(outDir, 'index.json');
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : {};

// ------------------------------------------------------------------ Beispielinhalt

// Widgets in den Zeilen-Blöcken – mit Beispiel-Items, deren Werte unten vorbelegt werden
const DEMO_CALLS = {
    'basic.flip': "basic.flip('', 'demo.licht', 'An', 'Aus')",
    'basic.print': "basic.print('', 'demo.temp', '°')",
    'basic.symbol': "basic.symbol('', 'demo.fenster', 'offen', 'fts_window_1w_open', 1)",
    'basic.stateswitch': "basic.stateswitch('', 'demo.szene', 'midi', 1, 'scene_cinema', 'Kino')",
    'basic.slider': "basic.slider('', 'demo.dimmer')",
    'device.uzsuicon': "device.uzsuicon('', 'demo.uzsu', 'Zeitschaltuhr')",
    'device.dimmer': "device.dimmer('', 'Deckenlicht', 'demo.licht', 'demo.dimmer')",
    'device.shutter': "device.shutter('', 'Rollladen', 'demo.rollo.move', 'demo.rollo.stop', 'demo.rollo.pos', '', 'demo.rollo.angle')",
    'device.rtr': "device.rtr('', 'Wohnzimmer', 'demo.rtr.ist', 'demo.rtr.soll')",
    'plot.period': "plot.period('', 'demo.temp', 'avg', '24h')",
};
const VALUES = {
    'demo.licht': 1, 'demo.dimmer': 180, 'demo.temp': 21.5, 'demo.feuchte': 48, 'demo.fenster': 1, 'demo.szene': 0,
    'demo.rollo.pos': 120, 'demo.rollo.angle': 40, 'demo.rollo.move': 0, 'demo.rollo.stop': 0, 'demo.rtr.ist': 21.3, 'demo.rtr.soll': 22,
};
const call = (name) => `{{ ${DEMO_CALLS[name]} }}`;
const row = (label, html) => `<tr><td align="left">${label}</td><td width="100px">${html}</td></tr>`;
const table = (rows) => `<table width="90%" align="center">\n${rows}\n</table>`;
const buttons = '<span data-role="controlgroup" data-type="horizontal">\n'
    + "{{ basic.stateswitch('', 'demo.szene', 'midi', 1, 'scene_cinema', 'Kino') }}\n"
    + "{{ basic.stateswitch('', 'demo.szene', 'midi', 2, 'scene_dinner', 'Essen') }}\n"
    + "{{ basic.stateswitch('', 'demo.szene', 'midi', 3, 'scene_party', 'Party') }}\n</span>";
const navEntry = (title, rows) => '<li data-icon="false"><a href="#">'
    + `<img class="icon" src='{{ icon0 }}scene_livingroom.svg'/><h3>${title}</h3>`
    + `<div class="ui-li-aside"><table align="right">${rows}</table></div></a></li>`;
const navValue = (label, item, unit) => `<tr><td width="90px">${label}:</td><td align="right" width="50px"> {{ basic.print('', '${item}', '${unit}') }} </td></tr>`;

// Platzhalter-Texte der Snippets -> Beispieltext
const LABELS = { Titel: 'Wohnzimmer', Bezeichnung: 'Deckenlicht', 'Abschnitt 1': 'Licht', 'Abschnitt 2': 'Rollläden', Bereich: 'Erdgeschoss', 'Reiter 1': 'Licht', 'Reiter 2': 'Klima' };

// je Block: Inhalt der Tabstopps (Nummer -> HTML)
const FILL = {
    heading: { 1: 'scene_livingroom' },
    block: { 1: 'Licht', 0: call('basic.flip') },
    blockSections: { 2: table(row('Deckenlicht', call('basic.flip'))) },
    blockStatic: { 1: 'Klima', 0: table(row('Temperatur', call('basic.print'))) },
    section: { 1: 'false', 2: 'Szenen', 0: buttons },
    columns: { 1: 'Licht', 2: table(row('Deckenlicht', call('basic.flip'))), 3: 'Klima', 0: table(row('Temperatur', call('basic.print'))) },
    table: { 0: call('basic.flip') },
    row: { 0: call('basic.flip') },
    rowFull: { 0: call('device.dimmer') },
    rowValue: { 1: 'Temperatur' },
    rowStatus: { 1: 'Fenster' },
    rowButton: { 1: 'Szene' },
    rowSlider: { 1: 'Helligkeit' },
    rowTimer: { 1: 'Zeitschaltuhr' },
    buttons: { 0: buttons.replace(/^<span[^>]*>\n|\n<\/span>$/g, '') },
    navList: { 0: navEntry('Wohnzimmer', navValue('Temperatur', 'demo.temp', '°')) },
    navEntry: { 1: 'rooms', 2: 'scene_livingroom', 4: 'Temperatur', 0: "{{ basic.print('', 'demo.temp', '°') }}" },
    navValue: { 1: 'Luftfeuchte', 0: '' },
    navbar: { 1: '#', 3: '#' },
    preblock: { 1: "<h3 style=\"margin: 0\">Wohnzimmer · {{ basic.print('', 'demo.temp', '°') }}</h3>", 0: call('basic.stateswitch') },
};
const navNarrow = new Set(['navList', 'navDivider', 'navEntry', 'navValue']);
const blockSet = (inner) => '<div class="block">\n<div class="set-1" data-role="collapsible-set" data-theme="c" data-content-theme="a" data-mini="true">\n'
    + inner + '\n</div>\n</div>';
const inBlock = (inner) => blockSet(`<div data-role="collapsible" data-collapsed="false">\n<h3>Wohnzimmer</h3>\n${inner}\n</div>`);
// Umgebung, in der der Block auf einer Seite steht (Zeilen in einer Tabelle, Einträge in einer Liste, …)
const CONTEXT = {
    section: blockSet,
    table: inBlock,
    navDivider: (html) => `<ul data-role="listview" data-dividertheme="c">\n${html}\n${navEntry('Wohnzimmer', navValue('Temperatur', 'demo.temp', '°'))}\n</ul>`,
    navEntry: (html) => `<ul data-role="listview" data-dividertheme="c">\n<li data-role="list-divider">Erdgeschoss</li>\n${html}\n</ul>`,
    navValue: (html) => `<ul data-role="listview" data-dividertheme="c">\n<li data-role="list-divider">Erdgeschoss</li>\n`
        + navEntry('Wohnzimmer', navValue('Temperatur', 'demo.temp', '°') + html.replace("'${2}'", "'demo.feuchte'").replace(/\{\{ basic\.print\([^)]*\) \}\}/, "{{ basic.print('', 'demo.feuchte', '%') }}")) + '\n</ul>',
};
for (const k of ['row', 'rowFull', 'rowSwitch', 'rowValue', 'rowStatus', 'rowButton', 'rowSlider', 'rowTimer', 'rowDimmer', 'rowShutter', 'rowRtr', 'rowPlot']) {
    CONTEXT[k] = (html) => inBlock(table(html));
}
// ohne Vorschau: ganze Seiten und Twig-Anweisungen (nichts zu sehen)
const SKIP = new Set(['page', 'layout', 'import', 'extends', 'twigBlock', 'include', 'if', 'for', 'macro']);

/** Snippet -> HTML: Widget-Aufrufe durch Beispiele ersetzen, Tabstopps füllen */
function fill(key, body) {
    const f = FILL[key] || {};
    return body
        .replace(/\{\{ ([a-z]+\.\w+)\(.*?\) \}\}/g, (m, name) => (DEMO_CALLS[name] ? call(name) : m))
        .replace(/\$\{(\d+)\|([^,|]*)[^}]*\|\}/g, (m, n, first) => (n in f ? f[n] : first))
        .replace(/\$\{(\d+):([^}]*)\}/g, (m, n, def) => (n in f ? f[n] : (LABELS[def] !== undefined ? LABELS[def] : def)))
        .replace(/\$\{(\d+)\}|\$(\d+)/g, (m, a, b) => {
            const n = a !== undefined ? a : b;
            return n in f ? f[n] : '';
        })
        .replace(/\\([$}\\])/g, '$1');
}

// ------------------------------------------------------------------ Seiten anlegen, fotografieren, aufräumen

const data = require('../data/widgets-3.6.json');
const widgets = new Map(data.widgets.map(w => [w.name, w]));
const snippets = structureSnippets({ view: { get: (n) => widgets.get(n) }, mode: 'required', version: '3.6' })
    .filter(s => !SKIP.has(s.key) && (!only.length || only.includes(s.key)));

const FIND = `(() => {
    const el = document.querySelector('.ui-page-active #svprev') || document.querySelector('#svprev');
    if (!el) return null;
    let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
    for (const c of el.children) {
        const r = c.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
    }
    return x2 < 0 ? null : { x: x1 + scrollX, y: y1 + scrollY, w: x2 - x1, h: y2 - y1 };
})()`;

(async () => {
    const tempBefore = new Set(fs.existsSync(tempDir) ? fs.readdirSync(tempDir) : []);
    fs.mkdirSync(pagesDir, { recursive: true });
    // Offline-Treiber wie die Doku, Design der Installation, Stile des eigenen Seitenordners
    fs.writeFileSync(path.join(pagesDir, 'config.ini'), 'driver = "offline"\ncalendar_service = "offline"\nphone_service = "offline"\ntitle = "Vorschau [smartVISU]"\n');
    if (style && fs.existsSync(path.join(install, 'pages', style, 'visu.css'))) fs.copyFileSync(path.join(install, 'pages', style, 'visu.css'), path.join(pagesDir, 'visu.css'));
    fs.writeFileSync(path.join(tempDir, `offline_${PAGES}.var`), Object.entries(VALUES).map(([k, v]) => `${k} = ${v}`).join('\n') + '\n');
    for (const s of snippets) {
        let html = fill(s.key, s.body);
        if (CONTEXT[s.key]) html = CONTEXT[s.key](html);
        const width = navNarrow.has(s.key) ? ' style="width: 380px"' : '';
        // ohne Mindesthöhe der Blöcke (14.5em), sonst ist die Vorschau meist leere Fläche
        fs.writeFileSync(path.join(pagesDir, `sv_${s.key}.html`),
            '{% extends "base.html" %}\n\n{% block content %}\n'
            + '<style>#svprev .block .ui-collapsible-content, #svprev .block .ui-fixed { min-height: 0 !important; }</style>\n'
            + `<div id="svprev"${width}>\n${html}\n</div>\n{% endblock %}\n`);
    }

    let b = await launch({ width: 1000, height: 900, port: 9433 });
    let done = 0;
    try {
        for (const s of snippets) {
            try {
                await b.goto(`${url}/index.php?pages=${PAGES}&page=sv_${s.key}`, s.key === 'rowPlot' ? 4500 : 2500);
                const r = await b.evaluate(FIND);
                if (!r) {
                    console.log(`–  ${s.key}: nichts zu sehen`);
                    continue;
                }
                // etwas Rand für Schatten und runde Ecken
                const m = 4;
                const clip = { x: Math.max(0, Math.floor(r.x) - m), y: Math.max(0, Math.floor(r.y) - m), width: Math.ceil(r.w) + 2 * m, height: Math.ceil(r.h) + 2 * m };
                fs.writeFileSync(path.join(outDir, s.key + '.png'), await b.screenshot(clip));
                index[s.key] = { w: clip.width, h: clip.height };
                done++;
                console.log(`✓  ${s.key} (${clip.width}×${clip.height})`);
            } catch (e) {
                console.log(`✗  ${s.key}: ${e.message}`);
                await b.close().catch(() => {});
                b = await launch({ width: 1000, height: 900, port: 9434 + done });
            }
        }
    } finally {
        await b.close().catch(() => {});
        const sorted = Object.fromEntries(Object.keys(index).sort().map(k => [k, index[k]]));
        fs.writeFileSync(indexFile, JSON.stringify(sorted, null, 1));
        if (!keep) {
            fs.rmSync(pagesDir, { recursive: true, force: true });
            for (const f of fs.readdirSync(tempDir)) if (!tempBefore.has(f) && f.includes(PAGES)) fs.rmSync(path.join(tempDir, f), { recursive: true, force: true });
            fs.rmSync(path.join(tempDir, `offline_${PAGES}.var`), { force: true });
        }
    }
    console.log(`\n${done} von ${snippets.length} Vorschaubildern${keep ? ` – Seiten bleiben in ${pagesDir}` : ''}`);
})().catch(e => {
    console.error(e);
    process.exit(1);
});
