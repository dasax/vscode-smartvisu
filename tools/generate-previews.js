'use strict';
// Vorschaubilder der Widgets für den Hover: erstes Beispiel jeder Widget-Seite der Online-Doku
// (docu.smartvisu.de) mit Edge/Chrome im Headless-Modus ausschneiden.
//
//   node tools/generate-previews.js [--docu 3.5] [--base <url>] [--force] [widget ...]
//
// --base: Doku einer eigenen Installation statt docu.smartvisu.de, z.B.
//   --docu 3.6 --base "http://smarthomeng/smartvisu/index.php?pages=docu&page="
// (die Doku-Seiten von smartVISU laufen mit dem Offline-Treiber, ohne Verbindung zu SmartHomeNG)
//
// Ergebnis: media/previews/<widget>.png und media/previews/index.json ({ widget: { w, h, docu } })

const fs = require('fs');
const path = require('path');
const { launch } = require('./cdp');

const args = process.argv.slice(2);
const opt = (name, def) => {
    const i = args.indexOf(name);
    if (i < 0) return def;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
};
const docu = opt('--docu', '3.5');
const base = opt('--base', `https://docu.smartvisu.de/${docu}/index.php?page=`);
const force = args.includes('--force');
const only = args.filter(a => !a.startsWith('--'));
const MAX_H = 240;

const outDir = path.join(__dirname, '..', 'media', 'previews');
fs.mkdirSync(outDir, { recursive: true });
const indexFile = path.join(outDir, 'index.json');
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : {};
// Bilder ohne Eintrag (z.B. nach abgebrochenem Lauf): Größe aus dem PNG-Kopf
for (const f of fs.readdirSync(outDir).filter(f => f.endsWith('.png'))) {
    const name = f.slice(0, -4);
    if (index[name]) continue;
    const head = fs.readFileSync(path.join(outDir, f)).subarray(16, 24);
    index[name] = { w: head.readUInt32BE(0), h: head.readUInt32BE(4), docu };
}
const saveIndex = () => {
    const sorted = Object.fromEntries(Object.keys(index).sort().map(k => [k, index[k]]));
    fs.writeFileSync(indexFile, JSON.stringify(sorted, null, 1));
};
saveIndex();
if (args.includes('--index-only')) process.exit(0);

// alle Widgets aller mitgelieferten Versionen (ohne Konfigurationsformulare)
const names = new Map();
for (const f of fs.readdirSync(path.join(__dirname, '..', 'data')).filter(f => /^widgets-.*\.json$/.test(f))) {
    for (const w of require(path.join(__dirname, '..', 'data', f)).widgets) if (w.ns !== 'forms') names.set(w.name, w);
}

// Rechteck des ersten sichtbaren Beispiels (div.html) auf der Seite
const FIND = `(() => {
    const page = document.querySelector('.ui-page-active') || document.body;
    for (const d of page.querySelectorAll('div.html')) {
        const r = d.getBoundingClientRect();
        const visible = [...d.querySelectorAll('*')].some(e => {
            const s = getComputedStyle(e);
            const b = e.getBoundingClientRect();
            return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 4 && b.height > 4;
        });
        if (r.width > 10 && r.height > 10 && visible) return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
    }
    return null;
})()`;

// dynamische Icons (icon.*) stehen gesammelt auf der Seite design/design_icons, je Icon ein div.box mit Namen
const FIND_ICONS = `(() => {
    const out = {};
    for (const box of document.querySelectorAll('.ui-page-active div.box, div.box')) {
        const label = box.lastElementChild && box.lastElementChild.innerText.trim();
        if (!/^icon\\.\\w+$/.test(label) || out[label]) continue;
        const r = box.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) out[label] = { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
    }
    return out;
})()`;

const want = (name) => (!only.length || only.includes(name)) && (force || !fs.existsSync(path.join(outDir, name + '.png')) || !index[name]);

// je Browserstart ein eigener Debug-Port (der alte Browser braucht etwas, bis er den Port freigibt)
let port = 9333;
const start = () => launch({ width: 1000, height: 900, port: port++ });

(async () => {
    let b = await start();
    let done = 0, skipped = 0;
    try {
        const icons = [...names.keys()].filter(n => n.startsWith('icon.') && want(n));
        if (icons.length) {
            let boxes = {};
            try {
                await b.goto(`${base}design/design_icons`, 3000);
                boxes = await b.evaluate(FIND_ICONS);
            } catch (e) {
                console.log(`✗  Icon-Galerie: ${e.message}`);
                await b.close();
                b = await start();
            }
            for (const name of icons) {
                const r = boxes[name];
                if (!r) {
                    skipped++;
                    console.log(`–  ${name}: nicht in der Icon-Galerie`);
                    continue;
                }
                const clip = { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.w), height: Math.ceil(r.h) };
                fs.writeFileSync(path.join(outDir, name + '.png'), await b.screenshot(clip));
                index[name] = { w: clip.width, h: clip.height, docu };
                saveIndex();
                done++;
                console.log(`✓  ${name} (${clip.width}×${clip.height})`);
            }
        }
        for (const [name, w] of names) {
            if (name.startsWith('icon.') || !want(name)) continue;
            const file = path.join(outDir, name + '.png');
            const url = `${base}${w.ns}/widget_${w.ns}.${w.macro}`;
            try {
                await b.goto(url, /^(plot|calendar|weather)\./.test(name) ? 4000 : 2500);
                const r = await b.evaluate(FIND);
                if (!r) {
                    skipped++;
                    console.log(`–  ${name}: kein sichtbares Beispiel`);
                    continue;
                }
                // 1 px Rand (gepunktete Umrandung der Doku) abschneiden, Höhe begrenzen
                const clip = { x: Math.ceil(r.x) + 1, y: Math.ceil(r.y) + 1, width: Math.floor(r.w) - 2, height: Math.min(Math.floor(r.h) - 2, MAX_H) };
                fs.writeFileSync(file, await b.screenshot(clip));
                index[name] = { w: clip.width, h: clip.height, docu };
                saveIndex();
                done++;
                console.log(`✓  ${name} (${clip.width}×${clip.height})`);
            } catch (e) {
                skipped++;
                console.log(`✗  ${name}: ${e.message}`);
                // hängende Seite (z.B. quad.*) blockiert den Tab – Browser neu starten, sonst bleiben alle folgenden leer
                await b.close();
                b = await start();
            }
        }
    } finally {
        await b.close();
        saveIndex();
    }
    console.log(`\n${done} Vorschaubilder erzeugt, ${skipped} ohne Bild.`);
})().catch(e => {
    console.error(e);
    process.exit(1);
});
