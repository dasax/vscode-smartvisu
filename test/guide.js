'use strict';
// Test des Guides (Explorer-Baum) mit nachgebildeter API: node test/guide.js <seitenordner> [<smarthomeng-verzeichnis>]
// Gibt den Baum aus wie in der Seitenleiste und prüft, was beim Einfügen an verschiedenen Stellen herauskommt.

const path = require('path');
const { install, makeDoc } = require('./mock-vscode');

const [pagesDir, shngDir] = process.argv.slice(2);
const vscode = install({
    'smartvisu.version': 'auto',
    'smartvisu.items.source': shngDir ? 'path' : 'auto',
    'smartvisu.items.path': shngDir || '',
    'smartvisu.insertParameters': 'learned',
    'smartvisu.language': 'de',
});
require('../lib/i18n').setLanguage('de');
const { Env } = require('../lib/env');
const { Features } = require('../lib/features');
const { Guide } = require('../lib/guide');

let failed = 0;
const expect = (what, ok) => {
    console.log(`${ok ? '  ok ' : '  FEHLER'} ${what}`);
    if (!ok) failed++;
};

(async () => {
    const env = new Env();
    const features = new Features(env);
    const guide = new Guide(env, features);
    // Seite ohne {% import "selfDefined.html" %} – eigene Widgets brauchen dann den Import
    const page = `{% extends "rooms.html" %}

{% block content %}
<h1>Test</h1>
<table>
<tr><td align="left">Licht</td><td></td></tr>
<tr><td>{{  }}</td></tr>
</table>
{% endblock %}
`;
    const doc = makeDoc(path.join(pagesDir, 'rooms.eg.test.html'), page);
    guide.doc = doc;

    // Baum ausgeben (aufgeklappte Gruppen ganz, zugeklappte nur mit Anzahl)
    const print = async (nodes, depth, open) => {
        for (const n of nodes) {
            const it = guide.getTreeItem(n);
            const kids = await guide.getChildren(n);
            const desc = it.description ? '  — ' + String(it.description).slice(0, 70) : '';
            const ic = it.iconPath ? `[${it.iconPath.id}]` : '';
            console.log(`${'   '.repeat(depth)}${it.collapsibleState === 2 ? '▾' : it.collapsibleState === 1 ? '▸' : '·'} ${ic} ${it.label}${desc}`);
            if (kids.length && (open || it.collapsibleState === 2)) await print(kids.slice(0, open ? 4 : 99), depth + 1, false);
        }
    };
    const roots = await guide.getChildren();
    console.log('## Guide-Baum\n');
    await print(roots, 0, false);

    // einzelne Pakete zeigen
    const widgets = roots.find(n => n.id === 'widgets');
    console.log('\n## basic (aufgeklappt, erste Einträge)');
    await print([widgets.children.find(n => n.id === 'widgets/basic')], 0, true);

    const m = await guide.getModel();
    console.log(`\n## Modell: ${m.widgets.length} Widgets, ${m.snips.length} Code-Blöcke, ${m.entries.size} Einträge`);
    expect('Suchen steht oben', roots[0].type === 'search');
    expect('jeder Code-Block genau einmal im Baum', (() => {
        const keys = roots.find(n => n.id === 'blocks').children.flatMap(g => g.children.map(l => l.entry.s.key));
        return keys.length === m.snips.length && new Set(keys).size === keys.length;
    })());
    const ids = [];
    const walk = (ns) => ns.forEach(n => { ids.push(n.id); if (n.children) walk(n.children); });
    walk(roots);
    expect('Knoten-IDs eindeutig', new Set(ids).size === ids.length);
    const leaves = [];
    const collect = (ns) => ns.forEach(n => { if (n.type === 'entry') leaves.push(n); if (n.children) collect(n.children); });
    collect(roots);
    expect('Klick auf Einträge fügt nicht ein (nur ➕/Enter)', leaves.every(n => !guide.getTreeItem(n).command));
    expect('"Suchen …" öffnet per Klick die Suche', guide.getTreeItem(roots[0]).command.command === 'smartvisu.guide.search');
    // Enter ohne Argument nimmt den markierten Eintrag
    guide.view = { selection: [leaves[0]] };
    expect('Enter: markierter Eintrag', (await guide.entryOf(undefined)) === leaves[0].entry);
    guide.view = { selection: [roots[1]] };
    expect('Enter auf einer Gruppe: nichts', !(await guide.entryOf(undefined)));
    guide.view = null;

    // Tooltip
    const flipNode = widgets.children.find(n => n.id === 'widgets/basic').children.find(n => n.entry.w.name === 'basic.flip');
    const tip = (await guide.resolveTreeItem(guide.getTreeItem(flipNode), flipNode)).tooltip.value;
    console.log('\n## Tooltip basic.flip (Anfang/Ende)\n' + tip.slice(0, 260) + '\n…\n' + tip.slice(-140));
    expect('Tooltip mit Vorschaubild und Hinweis', /!\[basic\.flip\]/.test(tip) && /Umschalttaste/.test(tip));
    const blockNode = roots.find(n => n.id === 'blocks').children.find(g => g.id === 'blocks/blocks').children.find(n => n.entry.s.key === 'block');
    const btip = (await guide.resolveTreeItem(guide.getTreeItem(blockNode), blockNode)).tooltip.value;
    console.log('\n## Tooltip sv:block (Anfang)\n' + btip.slice(0, 300));
    expect('Code-Block-Tooltip mit Vorschaubild und Code', /!\[sv:block\]\(.*blocks\/block\.png\|width=\d+,height=\d+\)/.test(btip) && /```html/.test(btip));

    // Einfügen
    const at = (needle, delta = 0) => doc.positionAt(page.indexOf(needle) + needle.length + delta);
    const flip = m.entries.get('w:basic.flip');
    let ins = await guide.insertion(flip, doc, at('<td align="left">Licht</td><td>'));
    console.log('\n## Einfügen basic.flip in leere Zelle:  ' + ins.body);
    expect('außerhalb von {{ }} mit Klammern', /^\{\{ basic\.flip\(.*\) \}\}$/.test(ins.body));
    ins = await guide.insertion(flip, doc, at('<tr><td>{{ '));
    console.log('## Einfügen basic.flip in {{ | }}:      ' + ins.body);
    expect('innerhalb von {{ }} ohne Klammern', /^basic\.flip\(/.test(ins.body));

    const block = m.entries.get('s:block');
    ins = await guide.insertion(block, doc, at('</table>\n'));
    console.log('## Einfügen sv:block:\n' + ins.body.split('\n').map(l => '   ' + l).join('\n'));
    expect('Code-Block als Snippet', /class="block"/.test(ins.body));
    ins = await guide.insertion(m.entries.get('s:page'), doc, at('</table>\n'));
    console.log('## sv:page erbt von: ' + /extends "([^"]*)"/.exec(ins.body)[1]);

    const custom = m.widgets.find(e => e.w.importFile);
    if (custom) {
        ins = await guide.insertion(custom, doc, at('<td align="left">Licht</td><td>'));
        console.log(`\n## Eigenes Widget ${custom.w.name} (nicht importiert):\n   ${ins.importLine.trim()}  @ Zeile ${ins.importPos.line + 1}\n   ${ins.body}`);
        expect('Import nach {% block content %}', ins.importPos.line === 3 && ins.importLine.includes(custom.w.importFile));
        // mit vorhandenem Import (anderer Alias): kein zweiter Import, Alias der Seite
        const page2 = page.replace('{% block content %}\n', `{% block content %}\n{% import "${custom.w.importFile}" as my %}\n`);
        const doc2 = makeDoc(path.join(pagesDir, 'rooms.eg.test.html'), page2);
        ins = await guide.insertion(custom, doc2, doc2.positionAt(page2.indexOf('<td></td>') + 4));
        console.log('## … mit {% import … as my %}: ' + ins.body);
        expect('Alias der Seite, kein Import', !ins.importLine && ins.body.startsWith('{{ my.' + custom.w.macro + '('));
    } else console.log('\n(keine nicht importierten eigenen Widgets im Seitenordner)');

    // Ziehen in den Editor
    const dt = new Map();
    guide.handleDrag([flipNode], { set: (k, v) => dt.set(k, v) });
    const drop = await guide.provideDocumentDropEdits(doc, at('<tr><td>{{ '), { get: (k) => dt.get(k) }, { isCancellationRequested: false })
        .catch(e => ({ error: e.message }));
    console.log('\n## Ziehen basic.flip nach {{ | }}: ' + (drop.error || drop.insertText && drop.insertText.value));

    console.log(failed ? `\n${failed} Fehler` : '\nalles ok');
    process.exit(failed ? 1 : 0);
})().catch(e => {
    console.error(e);
    process.exit(1);
});
