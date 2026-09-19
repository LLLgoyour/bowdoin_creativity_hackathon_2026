/* cdp.mjs — build the app, open the built page in headless Chrome, run one
 * experiment in it, hand back the JSON it returns.
 *
 * The probes that have to hear or see the app rather than read numbers (sound
 * from Web Audio, pixels from a canvas) all need the same plumbing, and this
 * file is that plumbing, once. No packages: Node's own fetch, WebSocket and
 * child_process, against the DevTools protocol directly.
 *
 * Three details here are not style, they are scars, and each one was paid for
 * by a probe that failed without it:
 *
 *   1. the DevTools socket is opened LAZILY, on the first `send`. Creating the
 *      WebSocket while loading the module reads the URL before it is assigned
 *      and throws `Invalid URL`;
 *   2. `Runtime.evaluate` races the initial navigation: the first execution
 *      context belongs to about:blank and is destroyed when the built page
 *      commits, so the readiness predicate is polled in a loop that tolerates
 *      context-destroyed errors instead of being evaluated once;
 *   3. the experiment evaluate itself retries up to three times when the
 *      context is swapped underneath it.
 *
 * usage:
 *   import {noBrowser, runPage} from './cdp.mjs';
 *   if (noBrowser()) { console.log('SKIP ...'); process.exit(0); }
 *   const {result} = await runPage(EXPERIMENT);
 */
import {spawn, execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const CANDIDATES = [process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);

/** Absolute path to a Chromium binary, or null when none is installed. */
export function chromePath() {
  return CANDIDATES.find(path => existsSync(path)) || null;
}

/** True when no Chromium was found; probes print a SKIP line and exit 0. */
export function noBrowser() {
  return !chromePath();
}

const freePort = () => new Promise(resolve => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => {
    const {port} = server.address();
    server.close(() => resolve(port));
  });
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Build the app with build.mjs into a temp dir, open the built page in headless
 * Chrome over the DevTools protocol, wait until the page is the real built
 * document with the app booted, evaluate `expression` (an async-IIFE source
 * string that returns a JSON string) with awaitPromise+returnByValue, and
 * return JSON.parse of that string.
 *
 * Always tears down Chrome and the temp dir, including on throw.
 *
 * `options.ready` is the readiness predicate evaluated in the page before the
 * experiment runs; callers that need a different global than SYNTH override it.
 * `options.timeoutMs` bounds each DevTools request.
 *
 * The returned value also carries the browser's `/json/version` reply as a
 * non-enumerable `version` property, so a probe can name the browser it
 * measured in without the connection details leaving this module. Being
 * non-enumerable, the value still compares equal to the JSON the page returned.
 */
export async function runPage(expression, options = {}) {
  const {timeoutMs = 180000, viewport = null,
    ready = "document.readyState==='complete'&&location.protocol==='file:'&&typeof SYNTH!=='undefined'"} = options;
  const browser = chromePath();
  assert(browser, 'no Chromium found: check noBrowser() before calling runPage');

  const work = mkdtempSync(join(tmpdir(), 'cdp-page-'));
  const page = join(work, 'app.html');
  const profile = join(work, 'profile');
  let child = null, socket = null;

  /* ── the DevTools connection: one target, one flattened session ─────────── */
  const send = (() => {
    let id = 0;
    const pending = new Map();
    let connecting = null;
    const connect = () => connecting || (connecting = new Promise((resolve, reject) => {
      const ws = new WebSocket(socket);
      socket = ws;                      /* the finally block closes whatever this is */
      ws.addEventListener('open', () => resolve(ws));
      ws.addEventListener('error', e => reject(new Error('devtools socket failed: ' + e.message)));
      ws.addEventListener('message', event => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
          const {resolve: done, reject: fail} = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) fail(new Error(msg.method + ': ' + msg.error.message));
          else done(msg.result);
        }
      });
    }));
    return async (method, params, sessionId) => {
      const ws = await connect();
      const messageId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(messageId, {resolve, reject});
        ws.send(JSON.stringify({id: messageId, method, params, sessionId}));
        setTimeout(() => {
          if (pending.has(messageId)) { pending.delete(messageId); reject(new Error(method + ' timed out')); }
        }, timeoutMs);
      });
    };
  })();

  try {
    execFileSync(process.execPath, [join(root, 'build.mjs'), page], {stdio: 'ignore'});
    assert(existsSync(page), 'build.mjs did not write the standalone page');

    const port = await freePort();
    child = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-extensions', '--disable-gpu',
      '--mute-audio',
      ...(viewport ? [`--window-size=${viewport.width},${viewport.height}`] : []),
      'about:blank'], {stdio: 'ignore'});

    let version = null;
    for (let i = 0; i < 120 && !version; i++) {
      try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
      catch (e) { await sleep(250); }
    }
    assert(version && version.webSocketDebuggerUrl, 'headless Chrome never opened its debug port');
    socket = version.webSocketDebuggerUrl;

    const {targetId} = await send('Target.createTarget', {url: 'file://' + page});
    const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
    /* Runtime.evaluate races the navigation: the first execution context is the
       blank one and is destroyed when the built page commits. Wait for the real
       document, and retry once if the context is still swapped underneath us. */
    const evaluate = async expression => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await send('Runtime.evaluate',
            {expression, awaitPromise: true, returnByValue: true}, sessionId);
        } catch (e) {
          if (attempt === 2 || !/context was destroyed|Cannot find context|Inspected target navigated/.test(e.message)) throw e;
          await sleep(400);
        }
      }
    };
    let booted = false;
    for (let i = 0; i < 120 && !booted; i++) {
      try {
        const probe = await send('Runtime.evaluate',
          {expression: ready, returnByValue: true}, sessionId);
        booted = probe.result.value === true;
      } catch (e) { /* the context is still being replaced: try again */ }
      if (!booted) await sleep(250);
    }
    assert(booted, 'the built page never finished loading in the headless browser');
    const evaluated = await evaluate(expression);
    if (evaluated.exceptionDetails)
      throw new Error('page experiment threw: ' +
        (evaluated.exceptionDetails.exception?.description || evaluated.exceptionDetails.text));
    const parsed = JSON.parse(evaluated.result.value);
    Object.defineProperty(parsed, 'version', {value: version, enumerable: false});
    return parsed;
  } finally {
    try { if (socket && socket.readyState === 1) socket.close(); } catch (e) {}
    try { if (child) child.kill('SIGKILL'); } catch (e) {}
    try { rmSync(work, {recursive: true, force: true}); } catch (e) {}
  }
}
