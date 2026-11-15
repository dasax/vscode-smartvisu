'use strict';
// Sprache der Oberfläche: Einstellung smartvisu.language ("en", "de", "auto" = Sprache von VS Code).
// Ohne VS-Code-Abhängigkeit. Texte in lib/l10n/<sprache>.json; fehlende Schlüssel fallen auf Englisch zurück.

const LANGUAGES = ['en', 'de'];
const dicts = {};
const load = (lang) => dicts[lang] || (dicts[lang] = require(`./l10n/${lang}.json`));

let current = 'en';

function setLanguage(setting, uiLanguage) {
    let lang = String(setting || 'auto').toLowerCase();
    if (lang === 'auto') lang = String(uiLanguage || 'en').toLowerCase().split('-')[0];
    current = LANGUAGES.includes(lang) ? lang : 'en';
    return current;
}

function language() {
    return current;
}

// Text zum Schlüssel; {0}, {1}, … werden durch die Argumente ersetzt
function t(key, ...args) {
    let s = load(current)[key];
    if (s === undefined) s = load('en')[key];
    if (s === undefined) return key;
    return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? String(args[i]) : m)) : s;
}

module.exports = { t, setLanguage, language, LANGUAGES };
