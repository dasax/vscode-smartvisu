'use strict';
// HTML-/Twig-Struktur für smartVISU-Seiten als Snippets – abgeleitet aus dem Aufbau der vorhandenen Seiten
// (Block mit aufklappbaren Abschnitten, Tabelle mit Bezeichnung | Widget, Navigationsliste, …).
// Ohne VS-Code-Abhängigkeit: liefert [{ key, desc, body, keywords }].

const { t } = require('./i18n');
const { callSnippet, esc } = require('./rank');

const COLLAPSIBLE_SET = 'data-role="collapsible-set" data-theme="c" data-content-theme="a" data-mini="true"';

// Auswahl ${n|a,b|} – Sonderzeichen in den Einträgen maskieren
function choice(n, values, fallback) {
    const list = [...new Set(values.filter(Boolean))];
    if (!list.length) return `\${${n}:${esc(fallback || '')}}`;
    if (list.length === 1) return `\${${n}:${esc(list[0])}}`;
    return `\${${n}|${list.map(v => String(v).replace(/[,|\\]/g, '\\$&')).join(',')}|}`;
}

const ph = (n, key) => `\${${n}:${esc(t('ph.' + key))}}`;

function defaultHeader() {
    return '/**\n* -----------------------------------------------------------------------------\n* @package     smartVISU\n'
        + '* @copyright   ${CURRENT_YEAR}\n* @license     GPL [http://www.gnu.de]\n'
        + '* -----------------------------------------------------------------------------\n*/';
}

// gelernter Kopfkommentar: Snippet-Zeichen maskieren, Copyright bis zum aktuellen Jahr
function headerFrom(h) {
    if (!h) return defaultHeader();
    return esc(h).replace(/(@copyright\s+)(\d{4})(?:\s*-\s*\d{4})?/, '$1$2 - ${CURRENT_YEAR}').replace(/\r\n/g, '\n');
}

/**
 * @param ctx { view (Widgets: get(name)), stats, mode, version,
 *              templates: [Vorlagen für extends], partials: [Dateien für include], macroFiles: [{ file, alias }] }
 */
function structureSnippets(ctx) {
    const { view, stats, mode } = ctx;
    const out = [];
    const add = (key, body, keywords) => out.push({ key, desc: t('snip.' + key), body, keywords: keywords || '' });
    const call = (name, first) => {
        const w = view.get(name);
        return w ? callSnippet(w, { mode, stats, first }) : null;
    };

    const templates = ctx.templates && ctx.templates.length ? ctx.templates : ['base.html'];
    add('page', `${headerFrom(stats && stats.header())}\n\n\n{% extends "${choice(1, templates)}" %}\n\n{% block content %}\n\n`
        + `<h1><img class="icon" src='{{ icon0 }}\${2}.svg' />${ph(3, 'title')}</h1>\n\n$0\n\n{% endblock %}\n`,
    'seite page datei neu new extends');

    const partials = ctx.partials && ctx.partials.length ? ctx.partials : ['navigation.html'];
    add('layout', `${headerFrom(stats && stats.header())}\n\n\n{% extends "base.html" %}\n\n{% block sidebar %}\n`
        + `\t{% include '${choice(1, partials)}' %}\n{% endblock %}\n\n{% block content %}\n\t{% include '$1' %}\n{% endblock %}\n`,
    'vorlage layout template sidebar seitenleiste navigation');

    add('heading', `<h1><img class="icon" src='{{ icon0 }}\${1}.svg' />${ph(2, 'title')}</h1>\n$0`, 'überschrift heading h1 titel title icon');

    add('block', `<div class="block">\n\t<div class="set-1" ${COLLAPSIBLE_SET}>\n`
        + `\t\t<div data-role="collapsible" data-collapsed="false">\n\t\t\t<h3>${ph(1, 'title')}</h3>\n`
        + `\t\t\t<table width="90%" align="center">\n\t\t\t\t<tr><td align="left">${ph(2, 'label')}</td><td width="100px">$0</td></tr>\n`
        + '\t\t\t</table>\n\t\t</div>\n\t</div>\n</div>',
    'block kasten box collapsible aufklappbar abschnitt section');

    add('blockSections', `<div class="block">\n\t<div class="set-2" ${COLLAPSIBLE_SET}>\n`
        + `\t\t<div data-role="collapsible" data-collapsed="false">\n\t\t\t<h3>${ph(1, 'section1')}</h3>\n\t\t\t$2\n\t\t</div>\n`
        + `\t\t<div data-role="collapsible">\n\t\t\t<h3>${ph(3, 'section2')}</h3>\n\t\t\t$0\n\t\t</div>\n\t</div>\n</div>`,
    'block abschnitte sections set-2 collapsible aufklappbar mehrere');

    add('blockStatic', `<div class="block">\n\t<div class="ui-bar-c ui-li-divider ui-corner-top">${ph(1, 'title')}</div>\n`
        + '\t<div class="ui-fixed ui-body-a ui-corner-bottom">\n\t\t$0\n\t</div>\n</div>',
    'block statisch static fest kasten box');

    add('section', `<div data-role="collapsible" data-collapsed="${choice(1, ['true', 'false'])}">\n\t<h3>${ph(2, 'title')}</h3>\n\t$0\n</div>`,
        'abschnitt section collapsible aufklappbar');

    const col = (title, content) => `<div class="block">\n\t<div class="set-1" ${COLLAPSIBLE_SET}>\n`
        + `\t\t<div data-role="collapsible" data-collapsed="false"><h3>${title}</h3>\n\t\t\t${content}\n\t\t</div>\n\t</div>\n</div>`;
    add('columns', `<!-- ${esc(t('ph.leftColumn'))} -->\n${col(ph(1, 'title'), '$2')}\n\n<!-- ${esc(t('ph.rightColumn'))} -->\n${col(ph(3, 'title'), '$0')}`,
        'spalten columns zwei two links rechts left right');

    add('table', `<table width="90%" align="center">\n\t<tr><td align="left">${ph(1, 'label')}</td><td width="100px">$0</td></tr>\n</table>`,
        'tabelle table zeile row');
    add('row', `<tr><td align="left">${ph(1, 'label')}</td><td width="100px">$0</td></tr>`, 'zeile row tr bezeichnung label');
    add('rowFull', '<tr><td colspan="2">$0</td></tr>', 'zeile row breit full colspan');

    // Zeilen mit Widget: Bezeichnung | Widget (bzw. über die volle Breite)
    const rows = [
        ['rowSwitch', 'basic.flip', false, 'schalter switch flip licht light an aus'],
        ['rowValue', 'basic.print', false, 'wert value anzeige print temperatur'],
        ['rowStatus', 'basic.symbol', false, 'status symbol anzeige zustand'],
        ['rowButton', 'basic.stateswitch', false, 'button taster stateswitch szene scene'],
        ['rowSlider', 'basic.slider', false, 'slider schieberegler wert'],
        ['rowTimer', 'device.uzsuicon', false, 'zeitschaltuhr timer uzsu zeitplan'],
        ['rowDimmer', 'device.dimmer', true, 'dimmer licht light helligkeit'],
        ['rowShutter', 'device.shutter', true, 'rollladen jalousie shutter blind'],
        ['rowRtr', 'device.rtr', true, 'heizung raumtemperatur rtr thermostat'],
        ['rowPlot', 'plot.period', true, 'diagramm plot verlauf chart'],
    ];
    for (const [key, name, full, kw] of rows) {
        if (full) {
            const c = call(name, 1);
            if (c) add(key, `<tr><td colspan="2">{{ ${c.body} }}</td></tr>`, kw);
        } else {
            const c = call(name, 2);
            if (c) add(key, `<tr><td align="left">${ph(1, 'label')}</td><td width="100px">{{ ${c.body} }}</td></tr>`, kw);
        }
    }

    add('buttons', '<span data-role="controlgroup" data-type="horizontal">\n\t$0\n</span>', 'buttons gruppe group controlgroup szenen scenes');

    add('navList', `<ul data-role="listview" data-dividertheme="c">\n\t<li data-role="list-divider">${ph(1, 'area')}</li>\n\t$0\n</ul>`,
        'navigation liste list listview menü menu');
    add('navDivider', `<li data-role="list-divider">${ph(1, 'area')}</li>`, 'navigation trenner divider bereich');
    add('navEntry', '<li data-icon="false">\n\t<a href="index.php?page=${1}">\n'
        + `\t\t<img class="icon" src='{{ icon0 }}\${2}.svg'/><h3>${ph(3, 'title')}</h3>\n`
        + '\t\t<div class="ui-li-aside">\n\t\t\t<table align="right">\n'
        + `\t\t\t\t<tr><td width="90px">${ph(4, 'label')}:</td><td align="right" width="50px"> $0 </td></tr>\n`
        + '\t\t\t</table>\n\t\t</div>\n\t</a>\n</li>',
    'navigation eintrag entry seite page link');
    const nv = call('basic.print', 2);
    if (nv) add('navValue', `<tr><td width="90px">${ph(1, 'label')}:</td><td align="right" width="50px"> {{ ${nv.body} }} </td></tr>`,
        'navigation wert value aside anzeige');
    add('navbar', '<div data-role="navbar" class="nav-custom">\n\t<ul>\n'
        + `\t\t<li><a href="index.php?page=\${1}" class="ui-btn-icon-top ui-btn-active ui-state-persist">${ph(2, 'tab1')}</a></li>\n`
        + `\t\t<li><a href="index.php?page=\${3}" class="ui-btn-icon-top">${ph(4, 'tab2')}</a></li>\n\t</ul>\n</div>`,
    'reiter tabs navbar leiste');
    add('preblock', '<div class="preblock">\n\t<div class="left">\n\t\t$1\n\t</div>\n\t<div class="right">\n\t\t$0\n\t</div>\n</div>',
        'kopfzeile preblock header leiste oben');

    // Twig
    const mf = ctx.macroFiles || [];
    if (mf.length) {
        add('import', `{% import "${choice(1, mf.map(m => m.file))}" as \${2:${esc(mf[0].alias)}} %}`, 'import makro macro eigene widgets');
    } else {
        add('import', `{% import "\${1:${esc(t('ph.file'))}}" as \${2:alias} %}`, 'import makro macro eigene widgets');
    }
    add('extends', `{% extends "${choice(1, templates)}" %}`, 'extends vorlage template');
    add('twigBlock', `{% block ${choice(1, ['content', 'sidebar'])} %}\n\t$0\n{% endblock %}`, 'block twig content sidebar');
    add('include', `{% include '${choice(1, partials)}' %}`, 'include einbinden');
    add('if', `{% if ${ph(1, 'condition')} %}\n\t$0\n{% endif %}`, 'if bedingung condition wenn');
    add('for', `{% for \${1:x} in ${ph(2, 'list')} %}\n\t$0\n{% endfor %}`, 'for schleife loop');
    const basicImport = ctx.version && ctx.version < '3.2' ? 'basic.html' : '@widgets/basic.html';
    add('macro', `/**\n* ${ph(1, 'widgetDesc')}\n*\n* @param {id=} unique id for this widget (optional)\n`
        + '* @param {item(bool,num)} ${3:the item}\n* @param {text=} ${4:label} (optional)\n*/\n'
        + `{% macro \${2:name}(id, item, txt) %}\n\t{% import "${basicImport}" as basic %}\n\t$0\n{% endmacro %}`,
    'makro macro eigenes widget custom');
    return out;
}

module.exports = { structureSnippets };
