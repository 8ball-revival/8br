/**
 * The guard and the snapshot the screenshot capture runs behind.
 *
 * ── Why the capture needs one at all ────────────────────────────────────────────────────────────
 * `capture:site-builder` publishes. That is what makes it proof rather than a mock-up — the pictures
 * are of a real editor really publishing to a real database. It also means it MUTATES, and every
 * mutating thing in this repository has a guard in front of it except, until now, this one.
 *
 * What it did instead was reset the homepage to the layout defined in code and publish that, so a
 * second run photographed the same site as the first. That is fine on a scratch database and wrong
 * anywhere else: it discards whatever the homepage actually said.
 *
 * ── What this adds ──────────────────────────────────────────────────────────────────────────────
 *   • A host check. Anything but a local database is refused outright.
 *   • An explicit acknowledgement. The operator has to say they accept that builder rows on this
 *     database will be written and restored.
 *   • A snapshot of exactly the `site_*` rows the capture touches, taken before it starts.
 *   • A restore in a `finally`, so an interrupted or failed run puts them back too.
 *   • A record on disk, so a run killed outright — where no `finally` gets to run — can be undone
 *     by the next invocation rather than never.
 *
 * ── What it deliberately does not do ────────────────────────────────────────────────────────────
 * It does not snapshot the whole database, and it does not touch any page the capture does not.
 * Restoring rows nobody wrote would be its own way of losing work.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Where an in-progress capture records what it has to put back. */
export const JOURNAL = '.fingerprints/capture-journal.json'

/** Exactly the pages the capture writes to. Nothing else is snapshotted or restored. */
export const TOUCHED_PAGE_KEYS = ['/'] as const

export interface PageSnapshot {
  key: string
  publishedRevisionId: string | null
  draftDocument: unknown | null
  draftVersion: number | null
  draftDirty: boolean | null
  /** Revision numbers present before the run, so anything the run added can be removed again. */
  revisionNumbers: number[]
}

export interface CaptureJournal {
  takenAt: string
  database: string
  pages: PageSnapshot[]
  /**
   * Template ids present before the run.
   *
   * The capture creates a template to photograph the zero-instance workflow, and a template it
   * created is as much a leftover as a revision it published. Recorded as a list of ids so that
   * only templates the run ADDED are removed — anything that existed first is not the run's to
   * delete.
   */
  templateIds: string[]
}

function envFile(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
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
      out[key] = value
    }
  } catch { /* no such file */ }
  return out
}

/**
 * Refuse anything that is not a local database, and anything the operator has not acknowledged.
 *
 * Two separate gates on purpose. The host check is the one that cannot be argued with — a remote
 * host is refused whatever anybody says. The acknowledgement is for the local case: writing to the
 * working copy of the live data is a legitimate thing to do deliberately and never a thing to do by
 * accident, so it has to be asked for.
 */
export function assertCaptureAllowed(): { databaseUrl: string; label: string } {
  const env = envFile('.env.replica')
  const url = process.env.DATABASE_URL || env.DATABASE_URL || ''
  if (!url) {
    throw new Error('No DATABASE_URL. The capture cannot tell which database it would be writing to.')
  }

  let host = ''
  let name = ''
  try {
    const parsed = new URL(url)
    host = parsed.hostname
    name = parsed.pathname.replace(/^\//, '')
  } catch {
    throw new Error('DATABASE_URL could not be read as a URL. Refusing to run.')
  }

  const LOCAL = ['127.0.0.1', 'localhost', '::1', '0.0.0.0']
  if (!LOCAL.includes(host)) {
    throw new Error(
      `Refusing to run: the database host is "${host}", which is not local.\n`
      + '  This script publishes. It is for a local copy or a disposable clone, and nothing else.',
    )
  }
  // A managed host can still resolve locally through a tunnel, so the name is checked as well.
  if (/prod|production|neon|vercel/i.test(name)) {
    throw new Error(`Refusing to run: the database is named "${name}", which does not look disposable.`)
  }

  const acknowledged = process.env.SB_CAPTURE_ACKNOWLEDGE === 'i-accept-local-writes'
    || process.argv.includes('--i-accept-local-writes')
  if (!acknowledged) {
    throw new Error(
      `This run will WRITE to the site builder tables of "${name}" on ${host}, and restore them\n`
      + '  afterwards. Every builder page it touches is listed before it starts, and nothing else is\n'
      + '  written. Competition data is never touched.\n\n'
      + '  Re-run with --i-accept-local-writes, or set\n'
      + '  SB_CAPTURE_ACKNOWLEDGE=i-accept-local-writes.',
    )
  }

  return { databaseUrl: url, label: `${name} on ${host}` }
}

/**
 * Snapshot the pages the capture will write to.
 *
 * Written to disk as well as returned. A `finally` covers a failure and an exception; it does not
 * cover a process that is killed, and that is precisely when somebody most wants their homepage
 * back. The journal on disk is what the next run reads to finish the job.
 */
export async function snapshotPages(prisma: PrismaLike, databaseLabel: string): Promise<CaptureJournal> {
  const pages: PageSnapshot[] = []
  for (const key of TOUCHED_PAGE_KEYS) {
    const page = await prisma.sitePage.findUnique({
      where: { key },
      include: { draft: true, revisions: { select: { number: true } } },
    })
    if (!page) continue
    pages.push({
      key,
      publishedRevisionId: page.publishedRevisionId,
      draftDocument: page.draft?.document ?? null,
      draftVersion: page.draft?.version ?? null,
      draftDirty: page.draft?.dirty ?? null,
      revisionNumbers: page.revisions.map((rev) => rev.number),
    })
  }

  const templateIds = (await prisma.siteTemplate.findMany({ select: { id: true } })).map((t) => t.id)
  const journal: CaptureJournal = { takenAt: new Date().toISOString(), database: databaseLabel, pages, templateIds }
  mkdirSync(dirname(JOURNAL), { recursive: true })
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 2))
  return journal
}

/**
 * Put back exactly what the snapshot recorded, and nothing else.
 *
 * Revisions the run ADDED are deleted, because leaving them makes the history read as though
 * somebody had published those layouts on purpose. Revisions that existed before are untouched: the
 * point is to restore, not to prune.
 */
export async function restorePages(prisma: PrismaLike, journal: CaptureJournal): Promise<string[]> {
  const notes: string[] = []
  for (const snap of journal.pages) {
    const page = await prisma.sitePage.findUnique({ where: { key: snap.key }, include: { draft: true } })
    if (!page) continue

    const added = await prisma.sitePageRevision.findMany({
      where: { pageId: page.id, number: { notIn: snap.revisionNumbers.length ? snap.revisionNumbers : [-1] } },
      select: { id: true, number: true },
    })

    // The page has to stop pointing at a revision before that revision can be removed.
    if (snap.publishedRevisionId !== page.publishedRevisionId) {
      await prisma.sitePage.update({
        where: { id: page.id },
        data: { publishedRevisionId: snap.publishedRevisionId },
      })
    }
    if (added.length) {
      await prisma.sitePageRevision.deleteMany({ where: { id: { in: added.map((rev) => rev.id) } } })
    }
    if (snap.draftDocument !== null && page.draft) {
      await prisma.sitePageDraft.update({
        where: { pageId: page.id },
        data: {
          document: snap.draftDocument as never,
          version: snap.draftVersion ?? page.draft.version,
          dirty: snap.draftDirty ?? false,
        },
      })
    }
    notes.push(`${snap.key}: published revision restored, ${added.length} revision${added.length === 1 ? '' : 's'} added by the run removed`)
  }

  /*
    Templates the run created.

    Deleting cascades to their revisions, which is what the schema says should happen — a template's
    history belongs to the template. Templates that existed before the run are never touched.
  */
  const before = new Set(journal.templateIds ?? [])
  const now = await prisma.siteTemplate.findMany({ select: { id: true, name: true } })
  const addedTemplates = now.filter((t) => !before.has(t.id))
  if (addedTemplates.length) {
    await prisma.siteTemplate.deleteMany({ where: { id: { in: addedTemplates.map((t) => t.id) } } })
    notes.push(`removed ${addedTemplates.length} template${addedTemplates.length === 1 ? '' : 's'} the run created: ${addedTemplates.map((t) => t.name).join(', ')}`)
  }

  return notes
}

/**
 * Finish a previous run that never got to clean up.
 *
 * Called before a new run starts. A journal on disk means the last invocation was killed between
 * its snapshot and its restore, so the restore happens now, before anything else is written.
 */
export async function recoverInterruptedRun(prisma: PrismaLike, databaseLabel: string): Promise<string[]> {
  if (!existsSync(JOURNAL)) return []
  let journal: CaptureJournal
  try {
    journal = JSON.parse(readFileSync(JOURNAL, 'utf8')) as CaptureJournal
  } catch {
    rmSync(JOURNAL, { force: true })
    return ['a capture journal was present but could not be read; it has been discarded']
  }
  if (journal.database !== databaseLabel) {
    return [`a capture journal from a different database (${journal.database}) was found and left alone`]
  }
  const notes = await restorePages(prisma, journal)
  rmSync(JOURNAL, { force: true })
  return [`recovered an interrupted run from ${journal.takenAt}:`, ...notes]
}

export function clearJournal(): void {
  rmSync(JOURNAL, { force: true })
}

/** The narrow slice of the Prisma client this module uses, so it need not import the real one. */
interface PrismaLike {
  siteTemplate: {
    findMany: (args: unknown) => Promise<{ id: string; name?: string }[]>
    deleteMany: (args: unknown) => Promise<unknown>
  }
  sitePage: {
    findUnique: (args: unknown) => Promise<{
      id: string
      publishedRevisionId: string | null
      draft: { document: unknown; version: number; dirty: boolean } | null
      revisions: { number: number }[]
    } | null>
    update: (args: unknown) => Promise<unknown>
  }
  sitePageRevision: {
    findMany: (args: unknown) => Promise<{ id: string; number: number }[]>
    deleteMany: (args: unknown) => Promise<unknown>
  }
  sitePageDraft: {
    update: (args: unknown) => Promise<unknown>
  }
}
