'use strict';
// Minimale Nachbildung der VS-Code-API für Tests ohne VS Code (nur was die Erweiterung benutzt).
// Einbinden: require('./mock-vscode').install(settings) vor dem ersten require der Erweiterung.

const fs = require('fs');
const path = require('path');
const Module = require('module');

class Position {
    constructor(line, character) { this.line = line; this.character = character; }
    translate(dl, dc) { return new Position(this.line + (dl || 0), this.character + (dc || 0)); }
}
class Range {
    constructor(a, b, c, d) {
        if (typeof a === 'number') { this.start = new Position(a, b); this.end = new Position(c, d); } else { this.start = a; this.end = b; }
    }
    get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
}
class Uri {
    constructor(p) { this.fsPath = p; this.path = p.replace(/\\/g, '/'); this.scheme = 'file'; }
    static file(p) { return new Uri(path.resolve(p)); }
    static parse(s) { return new Uri(s); }
    static joinPath(u, ...parts) { return new Uri(path.join(u.fsPath, ...parts)); }
    toString() { return 'file://' + this.path; }
}
class EventEmitter {
    constructor() { this.l = []; this.event = (f) => { this.l.push(f); return { dispose() {} }; }; }
    fire(x) { this.l.forEach(f => f(x)); }
    dispose() {}
}
class CompletionItem {
    constructor(label, kind) { this.label = label; this.kind = kind; }
}
class CompletionList {
    constructor(items, isIncomplete) { this.items = items; this.isIncomplete = isIncomplete; }
}
class SnippetString { constructor(v) { this.value = v; } }
class MarkdownString {
    constructor(v) { this.value = v || ''; }
    appendMarkdown(s) { this.value += s; return this; }
    appendCodeblock(s, l) { this.value += '```' + (l || '') + '\n' + s + '\n```'; return this; }
}
class TextEdit { constructor(range, newText) { this.range = range; this.newText = newText; } }
class SignatureInformation { constructor(label, doc) { this.label = label; this.documentation = doc; this.parameters = []; } }
class ParameterInformation { constructor(label, doc) { this.label = label; this.documentation = doc; } }
class SignatureHelp {}
class Hover { constructor(contents, range) { this.contents = contents; this.range = range; } }
class Location { constructor(uri, pos) { this.uri = uri; this.range = pos; } }
class TreeItem { constructor(label, state) { this.label = label; this.collapsibleState = state; } }
class ThemeIcon { constructor(id, color) { this.id = id; this.color = color; } }
class ThemeColor { constructor(id) { this.id = id; } }
class DataTransferItem { constructor(v) { this.value = v; } asString() { return Promise.resolve(String(this.value)); } }
class DocumentDropEdit { constructor(insertText, title) { this.insertText = insertText; this.title = title; } }
class WorkspaceEdit { constructor() { this.edits = []; } insert(uri, pos, text) { this.edits.push({ uri, pos, text }); } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }

const FileType = { File: 1, Directory: 2 };

function makeDoc(file, text, languageId = 'html') {
    const lines = text.split('\n');
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    return {
        uri: Uri.file(file),
        fileName: file,
        languageId,
        getText: () => text,
        lineCount: lines.length,
        lineAt: (l) => ({ text: lines[typeof l === 'number' ? l : l.line].replace(/\r$/, '') }),
        offsetAt: (p) => starts[p.line] + p.character,
        positionAt: (o) => {
            let l = 0;
            while (l + 1 < starts.length && starts[l + 1] <= o) l++;
            return new Position(l, o - starts[l]);
        },
    };
}

function install(settings = {}) {
    const vscode = {
        Position, Range, Uri, EventEmitter, CompletionItem, CompletionList, SnippetString, MarkdownString, TextEdit,
        SignatureInformation, ParameterInformation, SignatureHelp, Hover, Location, Diagnostic, FileType,
        TreeItem, ThemeIcon, ThemeColor, DataTransferItem, DocumentDropEdit, WorkspaceEdit,
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        QuickPickItemKind: { Separator: -1, Default: 0 },
        CompletionItemKind: new Proxy({}, { get: (t, k) => k }),
        CompletionItemTag: { Deprecated: 1 },
        CompletionTriggerKind: { Invoke: 0, TriggerCharacter: 1 },
        DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
        DiagnosticTag: { Deprecated: 2 },
        TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2, Command: 3 },
        RelativePattern: class { constructor(b, p) { this.base = b; this.pattern = p; } },
        env: { language: 'de' },
        workspace: {
            workspaceFolders: undefined,
            textDocuments: [],
            getConfiguration: (section) => ({ get: (k) => settings[`${section}.${k}`], update: async () => {} }),
            fs: {
                stat: async (u) => {
                    const s = await fs.promises.stat(u.fsPath);
                    return { mtime: s.mtimeMs, type: s.isDirectory() ? 2 : 1 };
                },
                readFile: async (u) => fs.promises.readFile(u.fsPath),
                readDirectory: async (u) => (await fs.promises.readdir(u.fsPath, { withFileTypes: true })).map(e => [e.name, e.isDirectory() ? 2 : 1]),
            },
            createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} }),
            onDidSaveTextDocument: () => ({ dispose() {} }),
            onDidOpenTextDocument: () => ({ dispose() {} }),
            onDidChangeTextDocument: () => ({ dispose() {} }),
            onDidCloseTextDocument: () => ({ dispose() {} }),
            openTextDocument: async (u) => makeDoc(u.fsPath, fs.readFileSync(u.fsPath, 'utf8')),
        },
        extensions: { getExtension: (id) => settings['ext:' + id] || undefined, onDidChange: () => ({ dispose() {} }) },
        languages: { createDiagnosticCollection: () => ({ set() {}, delete() {}, dispose() {} }) },
        window: {},
        commands: { executeCommand: async () => {} },
    };
    const orig = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
        if (request === 'vscode') return 'vscode';
        return orig.call(this, request, ...rest);
    };
    require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscode };
    return vscode;
}

module.exports = { install, makeDoc };
