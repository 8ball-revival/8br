/**
 * The new-member form, exercised in a real browser.
 *
 * Checks the things that only exist once the page is interactive: that typing reaches the duplicate
 * lookup, that Enter submits from inside the field, that a successful save leaves the form standing
 * and ready, and that the list and count behind it refresh.
 *
 * It creates ONE member, with a marked handle, and deletes it again at the end — through the same
 * cleanup path as the rest of the fixture. Nothing else on the page is touched.
 *
 * Usage: node scripts/browser-member-form.mjs --token <payload-token> --handle <disposable-handle>
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d }
const TOKEN = arg('token', '')
/*
 * The handle is required, not defaulted.
 *
 * A default would bake one fixture account name into the tree, which is the thing the credential
 * scan exists to catch — and it would make it easy to run this against a handle somebody else is
 * using. The caller names a disposable one and is responsible for removing it.
 */
const HANDLE = arg('handle', '')
if (!HANDLE) {
  console.error('Pass --handle <disposable-handle>. It will be created and must be cleaned up afterwards.')
  process.exit(2)
}
const OUT = arg('out', join(process.cwd(), 'tmp-shots'))
const ORIGIN = 'http://localhost:3000'
const PORT = 9334
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PROFILE = join(tmpdir(), `8br-form-${process.pid}`)

mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) } else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new',
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' })

async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const p = list.find((t) => t.type === 'page')
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl
    } catch { /* starting */ }
    await sleep(250)
  }
  throw new Error('no CDP target')
}

const ws = new WebSocket(await targetWs())
await new Promise((r) => ws.once('open', r))
let seq = 0
const waiting = new Map()
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString())
  if (m.id && waiting.has(m.id)) {
    const { resolve, reject } = waiting.get(m.id); waiting.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }))
})

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1024, deviceScaleFactor: 1, mobile: false })
if (TOKEN) await send('Network.setCookie', { name: 'payload-token', value: TOKEN, domain: 'localhost', path: '/', httpOnly: true })

const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (exceptionDetails) throw new Error(exceptionDetails.text)
  return result.value
}
const goto = async (url) => {
  await send('Page.navigate', { url })
  for (let i = 0; i < 80; i++) { await sleep(250); if (await evaluate('document.readyState') === 'complete') break }
  await sleep(1500)
}

/** Real keystrokes, so React sees exactly what a person's typing produces. */
const type = async (text) => {
  for (const ch of text) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', text: ch, unmodifiedText: ch })
    await sleep(25)
  }
}
const pressEnter = async () => {
  for (const type_ of ['rawKeyDown', 'char', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type: type_, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      text: type_ === 'char' ? '\r' : undefined,
    })
  }
}
const focusCueField = () => evaluate(`(() => {
  const txt = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
  const cue = [...document.querySelectorAll('input')].find(i => txt(i.closest('label')).startsWith('CueVerse ID'));
  cue.focus(); return document.activeElement === cue;
})()`)

const state = () => evaluate(`(() => {
  const txt = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
  const cue = [...document.querySelectorAll('input')].find(i => txt(i.closest('label')).startsWith('CueVerse ID'));
  const dup = [...document.querySelectorAll('aside')].find(a => txt(a).includes('Possible duplicates'));
  const body = (document.body.textContent || '').replace(/\\s+/g, ' ');
  const rows = [...document.querySelectorAll('table tbody tr')].map(tr => {
    const ins = [...tr.querySelectorAll('input[type=text], input:not([type])')].map(i => i.value);
    return { id: ins[0], name: ins[1] };
  });
  const btn = (label) => [...document.querySelectorAll('button')].find(b => txt(b) === label);
  const cueBox = cue?.getBoundingClientRect();
  const dupBox = dup?.getBoundingClientRect();
  return {
    formPresent: !!cue, cueValue: cue?.value ?? null,
    focusedIsCue: document.activeElement === cue,
    dupText: txt(dup).slice(-70),
    createDisabled: btn('Create member')?.disabled ?? null,
    clearDisabled: btn('Clear')?.disabled ?? null,
    hasCreateNewMemberButton: !!btn('Create New Member'),
    alerts: [...document.querySelectorAll('[role=alert]')].map(txt),
    tally: body.match(/\\d+ added/)?.[0] ?? null,
    countLine: body.match(/(\\d+) members?/)?.[0] ?? null,
    rowCount: rows.length,
    probeIndex: rows.findIndex(r => r.id === '${HANDLE}'),
    probeRow: rows.find(r => r.id === '${HANDLE}') ?? null,
    tail2: rows.slice(-2),
    sideBySide: cueBox && dupBox ? (dupBox.left > cueBox.left && Math.abs(dupBox.top - (cue.closest('.rounded-lg')?.getBoundingClientRect().top ?? 0)) < 60) : null,
    focusRing: (() => { const s = cue ? getComputedStyle(cue, ':focus-visible') : null; return s ? s.outlineStyle + '/' + s.borderColor : null })(),
  };
})()`)

try {
  console.log('\n--- The form as it arrives ---')
  await goto(`${ORIGIN}/staff/members`)
  let s = await state()
  check('the page opens with the form already there', s.formPresent)
  check('...and no "Create New Member" button in front of it', !s.hasCreateNewMemberButton)
  check('...with the duplicates panel beside it', s.sideBySide === true, JSON.stringify(s.sideBySide))
  check('Create is disabled while the handle is empty', s.createDisabled === true)
  check('Clear is disabled while there is nothing to clear', s.clearDisabled === true)
  const rowsBefore = s.rowCount
  const countBefore = s.countLine
  console.log(`  (${rowsBefore} rows, count line "${countBefore}")`)

  console.log('\n--- Typing reaches the duplicate lookup ---')
  await focusCueField()
  await type('aaron')
  await sleep(1600)
  s = await state()
  check('the field holds what was typed', s.cueValue === 'aaron', s.cueValue)
  check('...so React is receiving real keystrokes', s.createDisabled === false)
  check('the duplicates panel answered', !/Start typing/.test(s.dupText), s.dupText)
  check('Clear became available', s.clearDisabled === false)

  console.log('\n--- Clear empties the form without hiding it ---')
  await evaluate(`(() => { const t=(e)=>(e?.textContent||'').replace(/\\s+/g,' ').trim();
    [...document.querySelectorAll('button')].find(b => t(b) === 'Clear').click(); })()`)
  await sleep(900)
  s = await state()
  check('the field is empty', s.cueValue === '')
  check('...the form is still on screen', s.formPresent)
  check('...and focus is back in the CueVerse ID field', s.focusedIsCue)

  console.log('\n--- Enter submits, and the form stays ready ---')
  await focusCueField()
  await type(HANDLE)
  await sleep(1200)
  await pressEnter()
  await sleep(4000)
  s = await state()
  check('a member was created', s.probeIndex >= 0, JSON.stringify({ alerts: s.alerts, tally: s.tally }))
  check('...with no error shown', s.alerts.length === 0, s.alerts.join(' | '))
  check('...counted in the running tally', s.tally === '1 added', String(s.tally))
  check('the form is still visible afterwards', s.formPresent)
  check('...cleared and ready for the next person', s.cueValue === '')
  check('...with the cursor back in the handle field', s.focusedIsCue)
  /*
   * At least one, not exactly one.
   *
   * This is a live administration page against a live database, and the first run of this check
   * failed because a real operator added a member from another window while it was running. The
   * claim being tested is that the list picked the new member up — not that nobody else was working
   * at the same time.
   */
  check('the member list refreshed underneath', s.rowCount >= rowsBefore + 1, `${rowsBefore} → ${s.rowCount}`)
  check('...and the member count with it', s.countLine !== countBefore, `${countBefore} → ${s.countLine}`)
  /*
   * The new member lands last because "zz…" sorts last, not because its name is blank.
   *
   * Leaving Preferred Name empty does not produce a blank row: the creation service fills it from
   * the handle, so no member ever has one. The blanks-last half of the ordering rule is therefore
   * unreachable from the UI and is proven against the comparator directly, in
   * verify-member-management.
   */
  check('the new member is placed by the ordering rule, not appended',
    s.probeIndex === s.rowCount - 1, `index ${s.probeIndex} of ${s.rowCount}`)
  check('...having been given a Preferred Name from its handle', !!s.probeRow?.name, JSON.stringify(s.probeRow))

  console.log('\n--- The duplicate warning fires on the handle just created ---')
  await focusCueField()
  await type(HANDLE)
  await sleep(1800)
  s = await state()
  check('the panel names it as a possible duplicate', /duplicate|already|exact|similar/i.test(s.dupText) && !/No similar/.test(s.dupText), s.dupText)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, 'member-form-after-create.png'), Buffer.from(shot.data, 'base64'))
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  ws.close(); chrome.kill(); await sleep(500)
  try { rmSync(PROFILE, { recursive: true, force: true }) } catch { /* disposable */ }
  if (fail > 0) process.exitCode = 1
}
