'use strict';
// Minimaler Client für das Chrome DevTools Protocol (Edge/Chrome im Headless-Modus) – ohne Abhängigkeiten,
// benutzt das in Node ≥ 22 eingebaute WebSocket.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BROWSERS = [
    process.env.BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function launch({ width = 1000, height = 900, port = 9333 } = {}) {
    const exe = BROWSERS.find(b => fs.existsSync(b));
    if (!exe) throw new Error('Kein Edge/Chrome gefunden (Umgebungsvariable BROWSER setzen)');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-cdp-'));
    const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
        '--disable-extensions', '--hide-scrollbars', `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
    let target;
    for (let i = 0; i < 50 && !target; i++) {
        await sleep(200);
        try {
            const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
            target = list.find(t => t.type === 'page');
        } catch { /* Browser startet noch */ }
    }
    if (!target) throw new Error('Browser antwortet nicht');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
        } else if (msg.method) listeners.forEach(l => l(msg));
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const i = ++id;
        pending.set(i, { resolve, reject });
        ws.send(JSON.stringify({ id: i, method, params }));
    });
    const once = (method, timeout = 30000) => new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), timeout);
        listeners.push(function l(msg) {
            if (msg.method !== method) return;
            clearTimeout(t);
            listeners.splice(listeners.indexOf(l), 1);
            resolve(msg.params);
        });
    });
    // alert()/confirm() einer Seite würde den Browser blockieren – sofort bestätigen
    listeners.push((msg) => {
        if (msg.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    return {
        send,
        async goto(url, settle = 2000) {
            const loaded = once('Page.loadEventFired', 20000);
            await send('Page.navigate', { url });
            await loaded;
            await sleep(settle);
        },
        async evaluate(expr, timeout = 15000) {
            const r = await Promise.race([
                send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
                sleep(timeout).then(() => { throw new Error('Zeitüberschreitung'); }),
            ]);
            if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
            return r.result.value;
        },
        async screenshot(clip) {
            const r = await send('Page.captureScreenshot', { format: 'png', clip: Object.assign({ scale: 1 }, clip), captureBeyondViewport: true });
            return Buffer.from(r.data, 'base64');
        },
        async close() {
            try { await send('Browser.close'); } catch { /* schon zu */ }
            ws.close();
            setTimeout(() => {
                try { proc.kill(); } catch { /* beendet */ }
                try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* gesperrt */ }
            }, 500);
        },
    };
}

module.exports = { launch, sleep };
