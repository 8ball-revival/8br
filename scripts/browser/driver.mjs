/**
 * A small Chrome DevTools Protocol driver, shared by every browser verification script.
 *
 * ── Why a clean profile, always ──────────────────────────────────────────────────────────────────
 * The everyday Chrome on this machine runs Dark Reader, which rewrites styles before React hydrates
 * and reports as a hydration mismatch in the root layout on every page. A check that ran there would
 * fail for a reason that has nothing to do with the site. Every run gets a throwaway profile with no
 * extensions.
 *
 * ── Why localhost and not 127.0.0.1 ──────────────────────────────────────────────────────────────
 * They are the same machine and NOT the same origin to Next's dev server. Next 15.2+ refuses the
 * development client bootstrap to an origin it does not consider canonical, and the result is a page
 * that renders perfectly and never hydrates — no console error, no failed request, nothing in the
 * overlay. `allowedDevOrigins` in next.config.ts now permits both, and this defaults to the
 * canonical one so a missing config cannot silently produce a dead page again.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/*
  These scripts run under plain `node`, which does not read a .env file, and the dev server they
  drive is started by `npm run dev:replica`, which does. Without this the suites fail with
  "SITE_BUILDER_E2E_SECRET is not set" on a machine where it is perfectly well set — a confusing way
  to discover that two processes disagree about their environment. Existing variables always win, so
  an explicit `SB_BASE=... npm run test:responsive` still overrides.
*/
function loadEnvFile(file) {
  try {
    // Split on the line feed and trim, which handles a CRLF file without a regex literal.
    for (const raw of readFileSync(file, 'utf8').split(String.fromCharCode(10))) {
      const line = raw.trim()
      const eq = line.indexOf('=')
      if (eq < 1 || line.startsWith('#')) continue
      const key = line.slice(0, eq).trim()
      if (!/^[A-Z0-9_]+$/.test(key)) continue
      let value = line.slice(eq + 1).trim()
      if (value.length > 1 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
        value = value.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = value
    }
  } catch { /* no such file, which is fine */ }
}
loadEnvFile(path.join(process.cwd(), '.env.replica'))
loadEnvFile(path.join(process.cwd(), '.env'))

export const BASE = process.env.SB_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Launch headless Chrome on a throwaway profile and attach to its first page. */
export async function launch({ port = 9500 + Math.floor(Math.random() * 400) } = {}) {
  const profile = mkdtempSync(path.join(tmpdir(), 'sb-chrome-'))
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--headless=new', 'about:blank',
  ], { stdio: 'ignore' })

  let target = null
  for (let i = 0; i < 80 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = list.find((t) => t.type === 'page')
    } catch { /* not up yet */ }
    if (!target) await sleep(250)
  }
  if (!target) { chrome.kill(); throw new Error('Chrome did not start') }

  const cdp = connect(target.webSocketDebuggerUrl)
  await cdp.ready
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')
  await cdp.send('Log.enable')

  /** Set once a session has been created, so `close` knows whether there is anything to revoke. */
  let signedIn = false

  const events = { console: [], errors: [], failedRequests: [], hydrationWarnings: [] }
  cdp.on((m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a) => a.description || a.value || a.type).join(' ')
      if (m.params.type === 'error' || m.params.type === 'warning') events.console.push(`[${m.params.type}] ${text.slice(0, 300)}`)
      // React reports hydration problems as warnings or errors with distinctive wording.
      if (/hydrat|did not match|Text content does not match|server rendered HTML/i.test(text)) {
        events.hydrationWarnings.push(text.slice(0, 400))
      }
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails
      events.errors.push((d?.exception?.description || d?.text || '').slice(0, 500))
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      events.console.push(`[log] ${m.params.entry.text}`.slice(0, 300))
    }
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
      events.failedRequests.push(`${m.params.response.status} ${m.params.response.url.slice(0, 140)}`)
    }
  })

  return {
    cdp,
    events,
    clearEvents() { events.console.length = 0; events.errors.length = 0; events.failedRequests.length = 0; events.hydrationWarnings.length = 0 },
    async goto(url, wait = 3500) {
      await cdp.send('Page.navigate', { url: url.startsWith('http') ? url : BASE + url })
      await sleep(wait)
    },
    async viewport(width, height, mobile = false) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
    },
    /**
     * A real key press, through the protocol rather than a synthesised event.
     *
     * A dispatched `KeyboardEvent` carries `isTrusted: false`, and more to the point it never
     * reaches anything listening above the element it was dispatched on in the way a real press
     * does. Driving the input pipeline means the editor's shortcuts are exercised exactly as a
     * person exercises them, which is the only version worth asserting on.
     */
    async key(key, { ctrl = false, alt = false, shift = false, meta = false } = {}) {
      const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0)
      /*
        A named key without its virtual key code is a key press nothing reacts to.
        Chrome derives `keyCode` from this, and a handler testing `e.key === 'Escape'` sees the
        event but a handler testing `keyCode` does not — so both are supplied rather than one.
      */
      const CODES = { Escape: 27, Enter: 13, Tab: 9, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 }
      const code = CODES[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : undefined)
      const common = { modifiers, key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code }
      /*
        `text` is the character the key TYPES, not its name.

        Sending `text: 'Escape'` makes Chrome treat the press as typing the seven letters E-s-c-a-p-e
        into whatever has focus, and the Escape handler never runs. Only a printable key with no
        modifier has text at all; everything else is a `rawKeyDown`, which is what Chrome dispatches
        for a key that produces no character.
      */
      /*
        Enter carries a carriage return, and without it nothing is activated.

        Chrome generates a control's default action from the TEXT of an Enter press, not from its key
        code — so a `rawKeyDown` with no text focuses a button, presses it, and does nothing. That is
        indistinguishable from a button whose keyboard handling is broken, which is exactly the thing
        a keyboard-activation check is meant to detect.
      */
      const text = key === 'Enter' ? String.fromCharCode(13)
        : key.length === 1 && !ctrl && !meta ? key
          : null
      await cdp.send('Input.dispatchKeyEvent', text !== null
        ? { type: 'keyDown', ...common, text }
        : { type: 'rawKeyDown', ...common })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common })
      await sleep(200)
    },
    /**
     * A real mouse click at a point, for the same reason `key` exists.
     *
     * The editing overlay sits ON TOP of the canvas and owns selection — that is how a module can be
     * selected without its own click handlers firing and following a link. So `element.click()` on
     * the module underneath selects nothing, and a check built on it would be testing a path no
     * person can take. Clicking the point drives the overlay exactly as a pointer does.
     */
    async click(x, y) {
      const common = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...common })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...common })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...common })
      await sleep(250)
    },
    async eval(expression) {
      const r = await cdp.send('Runtime.evaluate', { returnByValue: true, expression, awaitPromise: true })
      if (r.result?.exceptionDetails) {
        return { __error: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || '').slice(0, 400) }
      }
      return r.result?.result?.value
    },
    async screenshot(file, { fullPage = false, width = 1600, height = 1000, scale = 1 } = {}) {
      const clip = fullPage
        ? { x: 0, y: 0, width, height: Math.min(height, 6000), scale }
        : undefined
      const shot = await cdp.send('Page.captureScreenshot',
        clip ? { format: 'png', captureBeyondViewport: true, clip } : { format: 'png' })
      const { writeFileSync, mkdirSync } = await import('node:fs')
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
      return file
    },
    /**
     * Sign in as the Owner without touching a single user row.
     *
     * Uses the development-only session route, which is refused outright unless NODE_ENV is not
     * production AND the secret is configured AND it matches AND the account is genuinely the Owner.
     */
    async signInAsOwner() {
      const secret = process.env.SITE_BUILDER_E2E_SECRET
      if (!secret) throw new Error('SITE_BUILDER_E2E_SECRET is not set; cannot sign in for verification.')
      await this.goto(`/dev-e2e-session?secret=${encodeURIComponent(secret)}`, 1500)
      const body = await this.eval('document.body.innerText.slice(0, 200)')
      if (!/"ok"\s*:\s*true/.test(String(body))) throw new Error(`Sign-in failed: ${String(body).slice(0, 160)}`)
      signedIn = true
      return true
    },
    /**
     * Remove the sessions this suite created.
     *
     * Called from `close`, which every suite calls in a `finally`, so it runs after a pass, after a
     * failure and after a thrown exception. It sweeps by the marker prefix rather than by the one id
     * it knows about, which is what also clears up after a run that was killed before it could.
     *
     * Only marked sessions are touched. A real sign-in on this machine is somebody's, not the
     * suite's, and is left alone.
     */
    async revokeOwnerSessions() {
      const secret = process.env.SITE_BUILDER_E2E_SECRET
      if (!secret || !signedIn) return { removed: 0 }
      try {
        const res = await fetch(`${BASE}/dev-e2e-session?secret=${encodeURIComponent(secret)}&all=1`, { method: 'DELETE' })
        return await res.json()
      } catch {
        // Never throws. Cleanup that can fail a passing suite is worse than cleanup that is late.
        return { removed: 0 }
      }
    },
    /**
     * Shut down, revoking whatever this suite created.
     *
     * `async`, and awaited by every caller, because a fire-and-forget revoke does not survive
     * `process.exit()` — the first version of this left exactly one session behind on every run,
     * which is the shape of the problem it was written to solve.
     *
     * The sweep is idempotent regardless: a run that is killed outright still gets cleaned up, by
     * the next sign-in.
     */
    async close() {
      await this.revokeOwnerSessions()
      /*
        Close the socket, let libuv finish with it, THEN kill Chrome.

        Killing the browser while the CDP WebSocket is mid-close aborts the handle underneath libuv,
        which asserts — `!(handle->flags & UV_HANDLE_CLOSING)` — and takes the process down with exit
        code 127 AFTER every check has passed. A suite that reports "36 passed, 0 failed" and then
        exits non-zero is the worst of both: it looks fine to a person and fails in CI.

        It only started happening when `close` became async: the await moved the socket teardown into
        the same tick as the kill. One turn of the loop between them is enough.
      */
      try { cdp.close() } catch { /* already gone */ }
      await sleep(50)
      chrome.kill()
      try { rmSync(profile, { recursive: true, force: true }) } catch { /* best effort */ }
    },
  }
}

function connect(url) {
  const ws = new WebSocket(url)
  let id = 0
  const waiting = new Map()
  const listeners = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id != null) { const f = waiting.get(m.id); if (f) { waiting.delete(m.id); f(m) } }
    else listeners.forEach((f) => f(m))
  })
  return {
    ready: new Promise((r) => ws.addEventListener('open', r)),
    on: (f) => listeners.push(f),
    send: (method, params = {}) => new Promise((res) => {
      const n = ++id
      waiting.set(n, res)
      ws.send(JSON.stringify({ id: n, method, params }))
    }),
    close: () => ws.close(),
  }
}

/** A tiny result recorder, so every suite reports the same way. */
export function reporter(title) {
  let pass = 0
  const failures = []
  return {
    check(name, ok, detail = '') {
      if (ok) pass++
      else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? `  (${detail})` : ''}`)
    },
    section(name) { console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 62 - name.length))}`) },
    /** How many have failed so far, for a caller that wants to keep diagnostics only on failure. */
    failures() { return failures.length },
    finish() {
      console.log(`\n${'═'.repeat(70)}`)
      if (failures.length) {
        console.log(`\n${title}: ${failures.length} FAILED\n`)
        failures.forEach((f) => console.log(`  ✗ ${f}`))
      }
      console.log(`\n${pass} checks passed, ${failures.length} failed\n`)
      return failures.length
    },
  }
}
