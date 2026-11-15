'use strict';
// Test der Faltbereiche: node test/folding.js [<seitenordner>]
// Prüft ein Beispiel und gibt für die Seiten im Ordner die gefundenen Bereiche aus.

const fs = require('fs');
const path = require('path');
const { foldingRanges } = require('../lib/folding');

let failed = 0;
const expect = (what, ok) => {
    console.log(`${ok ? '  ok ' : '  FEHLER'} ${what}`);
    if (!ok) failed++;
};
const show = (text, ranges) => {
    const lines = text.split('\n');
    for (const r of ranges) console.log(`  ${String(r.start + 1).padStart(4)}–${String(r.end + 1).padEnd(4)} ${(r.kind || '').padEnd(8)} ${lines[r.start].trim().slice(0, 70)}`);
};

const sample = [
    '/**',                                              // 0
    '* Kopf',                                           // 1
    '*/',                                               // 2
    '{% extends "rooms.html" %}',                       // 3
    '{% import "a.html" as a %}',                       // 4
    '{% import "b.html" as b %}',                       // 5
    '{% block title "Keller" %}',                       // 6  Kurzform, kein Bereich
    '{% set x = 1 %}',                                  // 7  kein Bereich
    '{% block content %}',                              // 8
    '{# mehrzeiliger',                                  // 9
    '   Kommentar #}',                                  // 10
    '{% if x %}',                                       // 11
    '  <p>ja</p>',                                      // 12
    '{% else %}',                                       // 13
    '  <p>nein</p>',                                    // 14
    '{% endif %}',                                      // 15
    '{{ basic.flip(',                                   // 16
    "    'id',",                                        // 17
    "    'eg.licht'",                                   // 18
    ') }}',                                             // 19
    '{% if a %}x{% else %}y{% endif %}',                // 20 einzeilig, kein Bereich
    '<script>',                                         // 21
    '/** kein Docblock',                                // 22
    '*/',                                               // 23
    '</script>',                                        // 24
    '{% verbatim %}',                                   // 25
    '{% if %}',                                         // 26 kein Twig
    '{% endverbatim %}',                                // 27
    '{% endblock %}',                                   // 28
].join('\n');
const got = foldingRanges(sample);
console.log('## Beispiel');
show(sample, got);
const has = (start, end, kind) => got.some(r => r.start === start && r.end === end && (r.kind || '') === (kind || ''));
expect('Docblock /** */ als Kommentar', has(0, 2, 'comment'));
expect('Imports zusammengefasst', has(4, 5, 'imports'));
expect('{% block content %} bis vor {% endblock %}', has(8, 27));
expect('{# #} über zwei Zeilen', has(9, 10, 'comment'));
expect('{% if %} bis vor {% else %}', has(11, 12));
expect('{% else %} bis vor {% endif %}', has(13, 14));
expect('mehrzeiliger Widget-Aufruf, ") }}" bleibt sichtbar', has(16, 18));
expect('verbatim gefaltet, Inhalt nicht als Twig gelesen', has(25, 26) && !got.some(r => r.start === 26));
expect('keine Bereiche für Kurzformen, Einzeiler und /** in <script>', !got.some(r => [6, 7, 20, 22].includes(r.start)));
expect('ohne Twig keine Bereiche', foldingRanges('<div>\n<p>\n</p>\n</div>').length === 0);

const dir = process.argv[2];
if (dir) {
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.html')).sort()) {
        const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
        const r = foldingRanges(text);
        // eigene Bereiche dürfen sich nicht überkreuzen (VS Code verwirft sonst einen davon)
        const crossed = r.filter((a, i) => r.some((b, j) => j !== i && a.start < b.start && b.start <= a.end && a.end < b.end));
        console.log(`\n## ${f}: ${r.length} Bereiche${crossed.length ? `, ${crossed.length} überkreuzt` : ''}`);
        show(text, r.slice(0, 8));
        if (r.length > 8) console.log(`  … ${r.length - 8} weitere`);
        if (crossed.length) failed++;
    }
}

console.log(failed ? `\n${failed} Fehler` : '\nalles ok');
process.exit(failed ? 1 : 0);
