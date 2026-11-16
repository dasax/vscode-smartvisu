'use strict';
// smartVISU Assistant – Unterstützung beim Erstellen von smartVISU-Seiten in VS Code:
// Widgets je smartVISU-Version mit Parametern und Hilfe, SmartHomeNG-Items als Vorschläge, Struktur-Snippets.

const vscode = require('vscode');
const i18n = require('./lib/i18n');
const { t } = i18n;
const { Env, BUNDLED } = require('./lib/env');
const { Features } = require('./lib/features');
const { Guide } = require('./lib/guide');
const twig = require('./lib/twig');
const { callSnippet, rankItems, fileTokens } = require('./lib/rank');
const { firstSentence, signature, docuUrl } = require('./lib/present');

const cfg = () => vscode.workspace.getConfiguration('smartvisu');
const applyLanguage = () => i18n.setLanguage(cfg().get('language'), vscode.env.language);

async function activate(context) {
    applyLanguage();
    const env = new Env();
    const features = new Features(env);
    context.subscriptions.push(env);
    features.register(context);
    // Guide im Explorer: Widgets und Code-Blöcke zum Durchblättern und Einfügen
    new Guide(env, features).register(context);

    // ------------------------------------------------------------------ Statusleiste
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    status.command = 'smartvisu.selectVersion';
    context.subscriptions.push(status);
    let statusSeq = 0;
    const updateStatus = async () => {
        const seq = ++statusSeq;
        const ed = vscode.window.activeTextEditor;
        const c = ed && await env.forDocument(ed.document).catch(() => null);
        if (seq !== statusSeq) return;
        if (!c) {
            status.hide();
            return;
        }
        const items = c.items;
        status.text = `$(versions) smartVISU ${c.catalog.version}` + (items.items.size ? ` · ${items.items.size} Items` : '');
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**smartVISU ${c.catalog.version}** — ${t('status.source.' + c.sel.source)}\n\n`);
        if (c.install) md.appendMarkdown(t('status.install', c.install.root.fsPath, c.install.version || '?') + '\n\n');
        md.appendMarkdown(t('status.pages', c.pagesDir.fsPath, c.info.pages.length) + '\n\n');
        const custom = c.view.all().filter(w => w.origin === 'custom').length;
        md.appendMarkdown(t('status.widgets', c.view.all().length - custom, custom) + '\n\n');
        if (items.kind === 'none') md.appendMarkdown(t('status.noItems') + '\n\n');
        else md.appendMarkdown(t('status.items', items.items.size, items.label) + '\n\n');
        if (items.error) md.appendMarkdown('⚠ ' + items.error + '\n\n');
        md.appendMarkdown(t('status.click'));
        status.tooltip = md;
        status.show();
    };
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(updateStatus),
        env.onDidChange(updateStatus),
    );

    // ------------------------------------------------------------------ Änderungen
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => env.fileSaved(doc.uri)),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('smartvisu.language')) applyLanguage();
            if (e.affectsConfiguration('smartvisu') || e.affectsConfiguration('shngItems.basePath')) env.clear();
        }),
        vscode.extensions.onDidChange(() => env.clear()),
    );

    // ------------------------------------------------------------------ Befehle
    const cmd = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

    cmd('smartvisu.afterInsert', () => setTimeout(() => features.maybeTrigger(vscode.window.activeTextEditor), 0));

    // Hilfe in der Vorschlagsliste mit den Pfeiltasten (Tastenbelegung in package.json):
    // → öffnet das Detailfenster von VS Code und setzt den Fokus hinein (↑/↓ blättern dort),
    // ← bzw. Esc gibt den Fokus an die Liste zurück und schließt das Fenster wieder, wenn → es geöffnet hat.
    let hideDetailsOnClose = false;
    cmd('smartvisu.suggestDetails', async (args = {}) => {
        if (args.close) {
            await vscode.commands.executeCommand('toggleSuggestionFocus');
            if (hideDetailsOnClose) await vscode.commands.executeCommand('toggleSuggestionDetails');
            hideDetailsOnClose = false;
            if (args.hideWidget) await vscode.commands.executeCommand('hideSuggestWidget');
        } else {
            hideDetailsOnClose = !!args.hide;
            await vscode.commands.executeCommand('toggleSuggestionFocus');
        }
    });

    cmd('smartvisu.reload', () => {
        env.clear();
        vscode.window.setStatusBarMessage(t('msg.reloaded'), 2500);
    });

    cmd('smartvisu.selectVersion', async () => {
        const current = cfg().get('version') || 'auto';
        const ed = vscode.window.activeTextEditor;
        const c = ed && await env.forDocument(ed.document).catch(() => null);
        const picks = [
            { label: 'auto', description: t('version.auto') + (c && c.install && c.install.version ? ` (${c.install.version})` : ''), value: 'auto' },
            { label: 'installed', description: t('version.installed'), value: 'installed' },
            ...BUNDLED.map(v => ({ label: v, description: t('version.bundled'), value: v })),
        ].map(p => Object.assign(p, { picked: p.value === current, label: (p.value === current ? '$(check) ' : '') + p.label }));
        const pick = await vscode.window.showQuickPick(picks, { title: t('version.title'), placeHolder: t('version.placeholder') });
        if (!pick) return;
        const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
        await cfg().update('version', pick.value, target);
    });

    cmd('smartvisu.insertWidget', async () => {
        const ed = vscode.window.activeTextEditor;
        if (!ed) return;
        const c = await env.forDocument(ed.document);
        if (!c) {
            vscode.window.showInformationMessage(t('msg.noSmartVisu'));
            return;
        }
        const ws = features.widgetOrder(c);
        const pick = await vscode.window.showQuickPick(ws.map(w => ({
            label: w.name,
            description: firstSentence(w.desc),
            detail: signature(w),
            w,
        })), { title: t('cmd.insertWidgetTitle', c.catalog.version), placeHolder: t('cmd.insertWidgetPlaceholder'), matchOnDescription: true });
        if (!pick) return;
        const x = twig.contextAt(ed.document.getText(), ed.document.offsetAt(ed.selection.active));
        const s = callSnippet(pick.w, { mode: cfg().get('insertParameters'), stats: c.info.stats });
        await ed.insertSnippet(new vscode.SnippetString(x.kind === 'expr' ? s.body : `{{ ${s.body} }}`));
        features.maybeTrigger(ed);
    });

    cmd('smartvisu.insertItem', async () => {
        const ed = vscode.window.activeTextEditor;
        if (!ed) return;
        const c = await env.forDocument(ed.document);
        if (!c || !c.items.items.size) {
            vscode.window.showInformationMessage(c ? t('status.noItems') : t('msg.noSmartVisu'));
            return;
        }
        const doc = ed.document;
        const x = twig.contextAt(doc.getText(), doc.offsetAt(ed.selection.active));
        const w = x.kind === 'expr' && x.call ? c.view.get(x.call.name) : null;
        const ranked = rankItems([...c.items.items.values()], {
            widget: w, param: w && w.params[x.argIndex], argIndex: x.argIndex, call: x.call, stats: c.info.stats, tokens: fileTokens(doc.fileName), near: [],
        });
        const pick = await vscode.window.showQuickPick(ranked.map(r => ({
            label: r.item.path,
            description: [r.item.type, r.item.name].filter(Boolean).join(' · '),
            item: r.item,
        })), { title: t('cmd.insertItemTitle'), placeHolder: t('cmd.insertItemPlaceholder'), matchOnDescription: true });
        if (!pick) return;
        const inString = x.kind === 'expr' && x.str;
        await ed.edit(e => e.replace(ed.selection, inString || x.kind !== 'expr' ? pick.item.path : `'${pick.item.path}'`));
    });

    cmd('smartvisu.openDocs', async () => {
        const ed = vscode.window.activeTextEditor;
        const c = ed && await env.forDocument(ed.document);
        let w = null;
        if (c) {
            const x = twig.contextAt(ed.document.getText(), ed.document.offsetAt(ed.selection.active));
            if (x.kind === 'expr' && x.call) w = c.view.get(x.call.name);
        }
        const d = c && env.docuFor(c);
        const url = c && w ? docuUrl(d.template, c.catalog.version, w) : null;
        if (url) vscode.env.openExternal(vscode.Uri.parse(url));
        else if (w && w.source) vscode.window.showTextDocument(w.source, { selection: new vscode.Range(w.line || 0, 0, w.line || 0, 0) });
        else vscode.env.openExternal(vscode.Uri.parse(d ? d.index : 'https://docu.smartvisu.de/3.5/index.php'));
    });

    await updateStatus();
}

function deactivate() {}

module.exports = { activate, deactivate };
