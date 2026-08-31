/**
 * Screenshots of the three states, for the record.
 *
 * Captures what an Owner actually sees in each one, plus the confirmation and the revision history.
 * It saves a draft (which is private and reversible) but never publishes, and it puts the draft back
 * the way it found it before it exits.
 *
 * Run: npx tsx --tsconfig tsconfig.scripts.json scripts/capture-theme-publish.mts
 */

import { readFileSync } from 'node:fs'
import { launch, sleep } from './browser/driver.mjs'

const env: Record<string, string> = {}
for (const raw of readFileSync('.env.replica', 'utf8').split(String.fromCharCode(10))) {
  const line = raw.trim(); const eq = line.indexOf('=')
  if (eq < 1 || line.startsWith('#')) continue
  let v = line.slice(eq + 1).trim()
  if (v.length > 1 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1)
  env[line.slice(0, eq).trim()] = v
}
process.env.DATABASE_URL ||= env.DATABASE_URL ?? ''
process.env.DIRECT_URL ||= env.DIRECT_URL ?? process.env.DATABASE_URL ?? ''
process.env.SITE_BUILDER_E2E_SECRET ||= env.SITE_BUILDER_E2E_SECRET ?? ''

const OUT = process.env.SHOT_DIR
  ?? 'C:/Users/Cerebro/AppData/Local/Temp/claude/C--Users-Cerebro/952b661e-7486-446a-90b1-a109d310f71e/scratchpad'

const { prisma } = await import('../src/lib/prisma')
await import('../src/components/site-builder/modules')
const { getDraft, saveDraft } = await import('../src/lib/site-builder/service')
const { THEME_PAGE_KEY } = await import('../src/lib/site-builder/globals')
const { normaliseTokens, THEME_PRESETS } = await import('../src/lib/theme/presets')

const ACTOR = { userId: 0, username: 'theme-capture' }
type Mod = { type: string; config: Record<string, unknown>; children?: unknown[] }
type Doc = { sections: { modules: Mod[] }[] }
const themeModule = (doc: Doc) => {
  const walk = (m: Mod[]): Mod[] => m.flatMap((x) => [x, ...walk((x.children ?? []) as Mod[])])
  return walk(doc.sections.flatMap((s) => s.modules)).find((m) => m.type === 'global.theme')
}
const draftNow = async () => {
  const d = await getDraft(THEME_PAGE_KEY)
  return d ? normaliseTokens(themeModule(d.document as unknown as Doc)?.config ?? {}) : {}
}
const startDraft = await draftNow()

const click = async (b: Awaited<ReturnType<typeof launch>>, text: string, scope = 'body') =>
  b.eval(`(function () {
    var root = document.querySelector(${JSON.stringify(scope)});
    if (!root) return 'no-scope';
    var el = Array.from(root.querySelectorAll('button')).filter(function (e) {
      return (e.textContent || '').trim().indexOf(${JSON.stringify(text)}) === 0;
    })[0];
    if (!el) return 'not-found';
    if (el.disabled) return 'disabled';
    el.click();
    return 'ok';
  })()`)

/** Crop to the lab panel so the state banner is legible rather than a speck in a full page. */
const shotPanel = async (b: Awaited<ReturnType<typeof launch>>, name: string) => {
  const box = await b.eval(`(function () {
    var p = document.querySelector('[role="tabpanel"]');
    if (!p) return null;
    var host = p.closest('[aria-labelledby]') || p.parentElement;
    var r = (host || p).getBoundingClientRect();
    return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), w: r.width + 16, h: r.height + 16 };
  })()`) as { x: number; y: number; w: number; h: number } | null
  const file = `${OUT}/theme-${name}.png`
  if (!box) { await b.screenshot(file); return file }
  await b.cdp.send('Page.captureScreenshot', { format: 'png' })
  const shot = await b.cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: box.x, y: box.y, width: box.w, height: Math.min(box.h, 4000), scale: 1 },
    captureBeyondViewport: true,
  })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
  return file
}

const b = await launch()
try {
  await b.viewport(1500, 1200, false)
  await b.signInAsOwner()
  await b.goto('/', 14000)
  await b.eval(`(function(){var e=document.querySelector('[aria-label="Customize Display"]');if(e)e.click();return !!e})()`)
  await sleep(1000)
  await b.eval(`(function(){var e=Array.from(document.querySelectorAll('[role="tab"]')).filter(function(x){return (x.textContent||'').trim().indexOf('Palette')===0})[0];if(e)e.click();return !!e})()`)
  await sleep(1400)

  // 1. Published: a clean browser, no personal overrides, showing what visitors get.
  console.log('published  ->', await shotPanel(b, '1-published'))

  // 2. Personal preview: a preset chosen, nothing saved, nothing public.
  const names = THEME_PRESETS.map((p) => p.name)
  await b.eval(`(function () {
    var names = ${JSON.stringify(names)};
    var el = Array.from(document.querySelectorAll('button[aria-pressed="false"]')).filter(function (e) {
      var t = (e.textContent || '').trim();
      return names.some(function (n) { return t.indexOf(n) === 0; });
    })[0];
    if (el) el.click();
    return !!el;
  })()`)
  await sleep(1600)
  console.log('preview    ->', await shotPanel(b, '2-personal-preview'))

  // 3. Saved draft: durable, still private.
  console.log('save:', await click(b, 'Save draft'))
  await sleep(3000)
  console.log('draft      ->', await shotPanel(b, '3-draft-saved'))

  // 4. The confirmation, which is the only step that asks.
  console.log('open:', await click(b, 'Publish site-wide'))
  await sleep(900)
  console.log('confirm    ->', await shotPanel(b, '4-publish-confirmation'))
  console.log('decline:', await click(b, 'Keep it private', '[role="alertdialog"]'))
  await sleep(1000)

  // 5. Revision history, with the rollback controls.
  console.log('history:', await click(b, 'Revision history'))
  await sleep(3500)
  console.log('history    ->', await shotPanel(b, '5-revision-history'))
} finally {
  try {
    const d = await getDraft(THEME_PAGE_KEY)
    if (d) {
      const doc = structuredClone(d.document) as unknown as Doc
      const mod = themeModule(doc)
      if (mod) {
        for (const k of Object.keys(normaliseTokens(mod.config))) mod.config[k] = ''
        for (const [k, v] of Object.entries(startDraft)) mod.config[k] = v
      }
      await saveDraft(THEME_PAGE_KEY, doc as never, d.version, ACTOR)
    }
    const back = await draftNow()
    const same = JSON.stringify(Object.entries(back).sort()) === JSON.stringify(Object.entries(startDraft).sort())
    console.log(same ? 'draft restored' : `! DRAFT NOT RESTORED: ${JSON.stringify(back)}`)
  } catch (err) {
    console.error('! could not restore the draft:', (err as Error).message)
  }
  await b.close()
  await prisma.$disconnect()
}
await new Promise((r) => { setTimeout(r, 250) })
process.exit(0)
