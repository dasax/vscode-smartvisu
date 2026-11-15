'use strict';
// Test der VS-Code-Teile mit nachgebildeter API: node test/features.js <seitenordner> [<smarthomeng-verzeichnis>]
// Simuliert Autovervollständigung, Parameterhilfe und Hover an typischen Stellen einer Seite.

const path = require('path');
const { install, makeDoc } = require('./mock-vscode');

const [pagesDir, shngDir] = process.argv.slice(2);
const settings = {
    'smartvisu.items.typeFilter': process.env.TYPEFILTER || 'learned',
    'smartvisu.version': 'auto',
    'smartvisu.items.source': shngDir ? 'path' : 'auto',
    'smartvisu.items.path': shngDir || '',
    'smartvisu.insertParameters': 'learned',
    'smartvisu.autoSuggest': true,
    'smartvisu.diagnostics': true,
    'smartvisu.language': 'de',
};
const vscode = install(settings);
require('../lib/i18n').setLanguage('de');
const { Env } = require('../lib/env');
const { Features } = require('../lib/features');

const label = (ci) => (typeof ci.label === 'string' ? ci.label : ci.label.label);
const desc = (ci) => (typeof ci.label === 'string' ? '' : ci.label.description || '');
const ins = (ci) => (ci.insertText && ci.insertText.value !== undefined ? ci.insertText.value : (ci.insertText !== undefined ? ci.insertText : label(ci)));

(async () => {
    const env = new Env();
    const f = new Features(env);
    const file = path.join(pagesDir, 'rooms.eg.bad.html');
    const page = `{% extends "rooms.html" %}
{% block content %}
{% import "selfDefined.html" as selfDefined %}
<table>
<tr><td align="left">Licht Decke</td><td>{{ basic.flip('', '') }}</td></tr>
<tr><td colspan="2">{{ device.dimmer('', 'Spiegel', 'eg.bad.licht.spiegel.schalten', '') }}</td></tr>
<tr><td>{{ basic.stateswitch('x', 'eg.bad.kontext.duschen', '') }}</td><td>{{ selfDefined.stateDisplayButton('', '', '', '') }}</td></tr>
<tr><td>
</td></tr>
<tr><td>Licht D</td></tr>
<img src='{{ icon0 }}light_.svg' />
<a href="index.php?page=rooms.">
{{ plot.period('p', 'eg.bad.temperatur.duscheAbfluss', 'avg', '') }}
</table>
{% endblock %}`;
    const doc = makeDoc(file, page);
    const at = (needle, delta = 0, trig) => {
        const off = page.indexOf(needle) + needle.length + delta;
        return f.provideCompletionItems(doc, doc.positionAt(off), { isCancellationRequested: false },
            trig ? { triggerKind: 1, triggerCharacter: trig } : { triggerKind: 0 });
    };
    const show = async (title, p, n = 6) => {
        const r = await p;
        const list = r ? (r.items || r) : [];
        console.log(`\n## ${title}: ${list.length} Vorschläge`);
        list.slice(0, n).forEach(ci => console.log(`   ${label(ci).padEnd(46)} ${desc(ci).slice(0, 40).padEnd(40)} → ${JSON.stringify(ins(ci)).slice(0, 90)}`));
        return list;
    };

    const c = await env.forDocument(doc);
    console.log('Version:', c.catalog.version, c.sel.source, '| Installation:', c.install && c.install.root.fsPath, c.install && c.install.version,
        '| Seitenordner:', c.pagesDir.fsPath, '| Items:', c.items.items.size, c.items.kind, c.items.error || '');
    console.log('Eigene Widgets:', c.view.all().filter(w => w.origin === 'custom').map(w => w.name).join(', '));
    console.log('Vorlagen:', c.info.templates.join(', '), '| Partials:', c.info.partials.join(', '), '| Makrodateien:', JSON.stringify(c.info.macroFiles));

    await show('Strg+Leertaste in leerer Tabellenzelle', at('<tr><td>\n', -1), 8);
    const all = await show('… davon Struktur-Snippets', at('<tr><td>\n', -1).then(l => l.items.filter(ci => label(ci).startsWith('sv:'))), 4);
    await show('Mitten in einer Beschriftung ("Licht D|")', at('Licht D'));
    await show('basic.flip: Item-Parameter (leerer String)', at("basic.flip('', '", 0), 8);
    await show('basic.flip: ID-Parameter', at("basic.flip('", 0));
    await show('device.dimmer: Item für den Dimmwert (nach …spiegel.schalten)', at("spiegel.schalten', '", 0), 5);
    await show('basic.stateswitch: Typ-Parameter', at("duschen', '", 0), 8);
    await show('eigenes Widget selfDefined.stateDisplayButton: Typ (4. Parameter)', at("stateDisplayButton('', '', '', '", 0), 6);
    await show('Icon nach {{ icon0 }}', at('{{ icon0 }}light_'), 5);
    await show('Seite in index.php?page=', at('page=rooms.'), 6);
    await show('plot.period: Dauer (tmin)', at("'avg', '", 0), 6);
    await show('Nach "{{ " (Trigger Leerzeichen)', at('{{ basic.flip', -10, ' '), 4);

    // Parameterhilfe beim Tippen und Hover über demselben Parameter sollen gleich aussehen
    const showParam = async (title, needle, delta) => {
        const off = page.indexOf(needle) + needle.length + (delta || 0);
        const sh = await f.provideSignatureHelp(doc, doc.positionAt(off));
        const s = sh.signatures[0];
        const d = s.parameters[0] && s.parameters[0].documentation;
        console.log(`\n## ${title}\n   Parameterhilfe: ${s.label}${d ? '\n                   ' + d.value.replace(/\n/g, '\n                   ') : ''}`);
        const hv = await f.provideHover(doc, doc.positionAt(off));
        console.log('   Hover:          ' + hv.contents.map(m => m.value).join('\n                   ---\n                   ').replace(/\n(?!\s{19})/g, '\n                   '));
    };
    await showParam('basic.flip: item', "basic.flip('', '", 0);
    await showParam('basic.flip: id', "basic.flip('", 0);
    await showParam('device.dimmer: item_value', "spiegel.schalten', '", 0);
    await showParam('device.dimmer: txt', "device.dimmer('', 'Sp", 0);
    await showParam('basic.stateswitch: type', "duschen', '", 0);
    await showParam('plot.period: tmin', "'avg', '", 0);

    const hv = await f.provideHover(doc, doc.positionAt(page.indexOf('device.dimmer') + 3));
    console.log('\n## Hover device.dimmer (Anfang):\n  ', hv.contents.value.slice(0, 600).replace(/\n/g, '\n   '));

    const resolved = f.resolveCompletionItem((await at("basic.flip('', '", 0)).items[0]);
    console.log('\n## Item-Doku in der Vorschlagsliste:\n  ', resolved.documentation.value.slice(0, 500).replace(/\n/g, '\n   '));

    // Snippet-Vorschau
    const block = all.find(ci => label(ci) === 'sv:block');
    if (block) console.log('\n## sv:block Doku:\n' + block.documentation.value);
})().catch(e => {
    console.error(e);
    process.exit(1);
});
