'use server'

/**
 * Saving, publishing and rolling back the site palette.
 *
 * ── This is not a second theme system ───────────────────────────────────────────────────────────
 * Every function here is a thin translation between "a map of 49 tokens" and "the config of the
 * `global.theme` module on the `theme` GLOBAL page". The draft, the revision, the publish, the
 * rollback, the audit entry and the cache invalidation are the site builder's, unchanged. Display
 * Lab is a different INTERFACE onto that page, not a different place to keep a theme.
 *
 * That is why there is no theme table, no theme revision table and no theme scheduler: they already
 * exist, they already work, and a second copy of them would be a second thing to get wrong.
 *
 * ── The rule these obey ─────────────────────────────────────────────────────────────────────────
 * Every one begins with `requireCapability('manage_site_builder')`, which is Owner-only. A server
 * action is a public HTTP endpoint with a generated name; the check on the first line is the only
 * thing between it and an anonymous request. An administrator without the Owner designation reaches
 * exactly as far here as a signed-out visitor does.
 */

import { requireCapability } from '@/lib/competition/staff-auth'
import {
  ConflictError, getDraft, publish, rollback, saveDraft,
} from '@/lib/site-builder/service'
import { THEME_PAGE_KEY } from '@/lib/site-builder/globals'
import { prisma } from '@/lib/prisma'
import type { LayoutDocument, ModuleInstance } from '@/lib/site-builder/document'
import { normaliseTokens } from './presets'
import { verdictFor } from './contrast'

const THEME_MODULE = 'global.theme'

export type ThemeActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; conflictVersion?: number; blocking?: string[] }

function fail(error: string, extra: Partial<{ conflictVersion: number; blocking: string[] }> = {}) {
  return { ok: false as const, error, ...extra }
}

async function guarded<T>(fn: () => Promise<ThemeActionResult<T>>): Promise<ThemeActionResult<T>> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ConflictError) {
      return fail(err.message, { conflictVersion: err.currentVersion })
    }
    console.error('[theme] action failed', err)
    return fail(err instanceof Error ? err.message : 'Something went wrong.')
  }
}

/** The theme module inside a layout document, or null when the page has not been bootstrapped. */
function themeModuleOf(doc: LayoutDocument): ModuleInstance | null {
  const walk = (mods: ModuleInstance[]): ModuleInstance[] =>
    mods.flatMap((m) => [m, ...walk(m.children ?? [])])
  return walk(doc.sections.flatMap((s) => s.modules)).find((m) => m.type === THEME_MODULE) ?? null
}

/** The palette a document currently holds, normalised. */
function paletteOf(doc: LayoutDocument): Record<string, string> {
  const mod = themeModuleOf(doc)
  return mod ? normaliseTokens(mod.config) : {}
}

export interface ThemeState {
  /** The palette every visitor is currently served. */
  published: Record<string, string>
  /** The palette saved as a draft, which only the Owner previewing it can see. */
  draft: Record<string, string>
  /** Optimistic-concurrency token. Passing a stale one is refused rather than merged. */
  version: number
  /** True when the draft differs from what is published. */
  dirty: boolean
  publishedRevision: { number: number; at: string; actor: string } | null
  bootstrapped: boolean
}

/**
 * What is published, what is drafted, and whether they differ.
 *
 * Read through the same service the public site reads, so the "published" reported here is by
 * construction the one a visitor is being served rather than a second query that could disagree.
 */
export async function getThemeStateAction(): Promise<ThemeActionResult<ThemeState>> {
  return guarded(async () => {
    await requireCapability('manage_site_builder')

    const page = await prisma.sitePage.findUnique({
      where: { key: THEME_PAGE_KEY },
      include: { publishedRevision: true },
    })
    if (!page) {
      const empty: ThemeState = {
        published: {}, draft: {}, version: 0, dirty: false,
        publishedRevision: null, bootstrapped: false,
      }
      return { ok: true, data: empty }
    }

    const draft = await getDraft(THEME_PAGE_KEY)
    const publishedDoc = page.publishedRevision?.document as unknown as LayoutDocument | undefined

    const published = publishedDoc ? paletteOf(publishedDoc) : {}
    const drafted = draft ? paletteOf(draft.document) : published

    const state: ThemeState = {
      published,
      draft: drafted,
      version: draft?.version ?? 0,
      dirty: JSON.stringify(published) !== JSON.stringify(drafted),
      publishedRevision: page.publishedRevision
        ? {
          number: page.publishedRevision.number,
          at: page.publishedRevision.publishedAt.toISOString(),
          actor: page.publishedRevision.publishedByUsername ?? 'unknown',
        }
        : null,
      bootstrapped: true,
    }
    return { ok: true, data: state }
  })
}

/**
 * Save a palette as the theme page's draft. Nothing public changes.
 *
 * The version is the draft's, and a stale one is REFUSED rather than merged: two Owner tabs open on
 * the same theme is exactly the case where a silent last-write-wins loses somebody's afternoon.
 */
export async function saveThemeDraftAction(
  tokens: Record<string, string>,
  version: number,
): Promise<ThemeActionResult<{ version: number }>> {
  return guarded(async () => {
    await requireCapability('manage_site_builder')

    const draft = await getDraft(THEME_PAGE_KEY)
    if (!draft) return fail('The theme page has not been created yet. Capture the site first.')

    const next = structuredClone(draft.document)
    const mod = themeModuleOf(next)
    if (!mod) return fail('The theme page has no theme module on it.')

    /*
      Only the palette keys are touched.

      The same module also carries the display font, corner radius, spacing scale and site width.
      Replacing its whole config from Display Lab would silently reset all four, so the incoming
      tokens are merged over what is there and everything else is left exactly as it was.
    */
    const clean = normaliseTokens(tokens)
    for (const key of Object.keys(paletteOf(next))) {
      if (!(key in clean)) mod.config[key] = ''
    }
    for (const [key, value] of Object.entries(clean)) mod.config[key] = value

    const actor = await requireCapability('manage_site_builder')
    const saved = await saveDraft(THEME_PAGE_KEY, next, version, actor)
    if (saved.issues > 0) return fail('The palette did not validate. Nothing was saved.')
    return { ok: true, data: { version: saved.version } }
  })
}

/**
 * Publish the saved draft site-wide.
 *
 * ── The contrast gate is applied HERE, not only in the panel ────────────────────────────────────
 * The browser check is a convenience for whoever is dragging a colour. This one is the rule: a
 * server action is reachable without the panel, and "the interface would not have offered the
 * button" is not a permission model. It re-evaluates the COMPLETE resolved cascade rather than the
 * fields that changed, because a token nobody touched can fail against a ground somebody did.
 */
export async function publishThemeAction(
  summary?: string,
): Promise<ThemeActionResult<{ revisionNumber: number }>> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')

    const draft = await getDraft(THEME_PAGE_KEY)
    if (!draft) return fail('The theme page has not been created yet.')

    const palette = paletteOf(draft.document)
    const verdict = verdictFor(palette)
    if (!verdict.publishable) {
      return fail(
        `${verdict.blocking.length} combination${verdict.blocking.length === 1 ? '' : 's'} would make essential text unreadable.`,
        { blocking: verdict.blocking.map((b) => `${b.where} — ${b.ratio}:1, needs ${b.needed}:1`) },
      )
    }

    const published = await publish(THEME_PAGE_KEY, actor, summary ?? 'Site palette')
    return { ok: true, data: { revisionNumber: published.revisionNumber } }
  })
}

/** Publish an earlier revision again. The current one is kept; rollback moves forward, not back. */
export async function rollbackThemeAction(
  revisionNumber: number,
): Promise<ThemeActionResult<{ revisionNumber: number }>> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const result = await rollback(THEME_PAGE_KEY, revisionNumber, actor)
    return { ok: true, data: { revisionNumber: result.revisionNumber } }
  })
}

export interface ThemeRevision {
  number: number
  at: string
  actor: string
  summary: string
  isPublished: boolean
  /** A few swatches, so a revision is recognisable without being applied. */
  swatches: string[]
}

/** The theme's revision history, newest first. */
export async function themeHistoryAction(): Promise<ThemeActionResult<ThemeRevision[]>> {
  return guarded(async () => {
    await requireCapability('manage_site_builder')

    const page = await prisma.sitePage.findUnique({
      where: { key: THEME_PAGE_KEY },
      include: { revisions: { orderBy: { number: 'desc' }, take: 30 } },
    })
    if (!page) return { ok: true, data: [] }

    const KEYS = ['void', 'graphite', 'cleanWhite', 'signal', 'gold']
    return {
      ok: true,
      data: page.revisions.map((r) => {
        const palette = paletteOf(r.document as unknown as LayoutDocument)
        return {
          number: r.number,
          at: r.publishedAt.toISOString(),
          actor: r.publishedByUsername ?? 'unknown',
          summary: r.summary ?? '',
          isPublished: r.id === page.publishedRevisionId,
          swatches: KEYS.map((k) => palette[k] ?? ''),
        }
      }),
    }
  })
}
