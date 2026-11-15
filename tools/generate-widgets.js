'use strict';
// Erzeugt data/widgets-<version>.json aus dem smartVISU-Repository (https://github.com/Martin-Gleiss/smartvisu).
//
// Je Tag ein schlanker Klon (nur widgets/ und pages/docu/ werden geladen), z.B. für v3.6:
//   git clone --depth 1 --branch v3.6 --filter=blob:none --sparse https://github.com/Martin-Gleiss/smartvisu.git <dir>/v3.6
//   git -C <dir>/v3.6 sparse-checkout set widgets pages/docu
//   node tools/generate-widgets.js <dir> [version ...]
//
// Je Version: alle Widgets aus widgets/*.html (Docblocks wie in smartVISU twig_docu()),
// entfernte/veraltete Widgets aus widgets/deprecated.yaml, Beispiele aus der Doku (pages/docu)
// und die Namen der mitgelieferten Icons (icons/ws).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseWidgets, parseDeprecated, parseExamples } = require('../lib/docblock');

// Version in den Einstellungen -> Git-Tag (jeweils das letzte Bugfix-Release)
const VERSIONS = {
    '2.9': 'v2.9.2',
    '3.0': 'v3.0.1',
    '3.1': 'v3.1',
    '3.2': 'v3.2.2',
    '3.3': 'v3.3.1',
    '3.4': 'v3.4',
    '3.5': 'v3.5',
    '3.6': 'v3.6',
};

const tagsDir = process.argv[2];
if (!tagsDir) {
    console.error('Aufruf: node tools/generate-widgets.js <verzeichnis-mit-einem-klon-je-tag> [version ...]');
    process.exit(1);
}
const wanted = process.argv.slice(3);
const outDir = path.join(__dirname, '..', 'data');

for (const [version, tag] of Object.entries(VERSIONS)) {
    if (wanted.length && !wanted.includes(version)) continue;
    const repo = path.join(tagsDir, tag);
    if (!fs.existsSync(repo)) {
        console.warn(`${version}: ${repo} fehlt – übersprungen`);
        continue;
    }
    // Dateiliste aus Git (icons/ws ist nicht ausgecheckt, die Namen reichen)
    const files = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', 'HEAD', '--', 'widgets', 'pages/docu', 'icons/ws'],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
    const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');

    const widgets = [];
    for (const f of files.filter(f => /^widgets\/[^/]+\.html$/.test(f))) {
        const ns = path.basename(f, '.html');
        for (const w of parseWidgets(read(f), ns)) {
            const docu = `pages/docu/${ns}/widget_${ns}.${w.macro}.html`;
            if (files.includes(docu)) {
                const ex = parseExamples(read(docu), w.name);
                if (ex.length) w.examples = ex;
            }
            w.file = f;
            widgets.push(w);
        }
    }
    const dep = files.includes('widgets/deprecated.yaml') ? parseDeprecated(read('widgets/deprecated.yaml')) : { removed: [], deprecated: [] };
    const icons = files.filter(f => /^icons\/ws\/[^/]+\.svg$/.test(f)).map(f => path.basename(f, '.svg')).sort();

    const data = { version, tag, generated: new Date().toISOString().slice(0, 10), widgets, removed: dep.removed, deprecated: dep.deprecated, icons };
    fs.writeFileSync(path.join(outDir, `widgets-${version}.json`), JSON.stringify(data));
    console.log(`${version} (${tag}): ${widgets.length} Widgets, ${icons.length} Icons, ${dep.removed.length} entfernt`);
}
