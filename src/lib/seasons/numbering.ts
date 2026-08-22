import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Season numbering: suggesting a number, checking one, and turning a lost race into a useful error.
 *
 * A Season number is unique only within its Competition AND year. "8BR Season 1 · 2005", "8BR Retro
 * Season 1 · 2026" and "8BR Season 1 · 2026" are all legitimate at the same time; only a repeat of
 * the same three together is a conflict.
 *
 * The number is a LABEL. Nothing addresses a Season by it — routes and relationships use the
 * immutable `id` — which is why an administrator may change it later, on a finished Season included,
 * without disturbing a single result.
 */

/** Postgres `integer`. A number past this cannot be stored, so it is rejected before it is tried. */
const MAX_SEASON_NUMBER = 2_147_483_647

export type NumberProblem =
  | { ok: true; value: number }
  | { ok: false; error: string }

/**
 * Accept positive whole numbers and nothing else.
 *
 * Takes `unknown` because the value arrives from a form: blank, "  ", "1.5", "abc", "-2", 0 and
 * 1e400 all have to be turned away with something an administrator can act on.
 */
export function parseSeasonNumber(raw: unknown): NumberProblem {
  if (raw === null || raw === undefined) return { ok: false, error: 'Enter a Season number.' }
  if (typeof raw === 'string' && raw.trim() === '') return { ok: false, error: 'Enter a Season number.' }

  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(n)) return { ok: false, error: 'Season number must be a whole number.' }
  if (!Number.isInteger(n)) return { ok: false, error: 'Season number must be a whole number, not a decimal.' }
  if (n < 1) return { ok: false, error: 'Season number must be 1 or greater.' }
  if (n > MAX_SEASON_NUMBER) return { ok: false, error: `Season number must be ${MAX_SEASON_NUMBER} or less.` }
  return { ok: true, value: n }
}

/**
 * The next number to offer for a Competition and year: the highest already used there, plus one.
 *
 * Deliberately MAX+1 rather than "lowest unused". Deleting Season 2 of three leaves a hole at 2, and
 * silently refilling it would quietly reuse a number people may still associate with the deleted
 * Season. The hole stays open; an administrator who wants it can type it.
 */
export async function suggestSeasonNumber(competitionSeriesId: number, competitionYear: number): Promise<number> {
  const top = await prisma.season.findFirst({
    where: { competitionSeriesId, competitionYear },
    orderBy: { number: 'desc' },
    select: { number: true },
  })
  return (top?.number ?? 0) + 1
}

/** Is this Competition/year/number already taken? `exceptSeasonId` lets a Season keep its own. */
export async function isSeasonNumberTaken(
  competitionSeriesId: number,
  competitionYear: number,
  number: number,
  exceptSeasonId?: number,
  division?: string | null,
): Promise<boolean> {
  /*
   * The DIVISION is part of the identity, and leaving it out made this stricter than the database.
   *
   * The unique index is (Competition, year, number, COALESCE(division, '')) — deliberately, so a
   * divisional pair can share a number, which is the whole point of divisions. This check asked
   * (Competition, year, number) and therefore refused Season 1 Division B whenever Season 1
   * Division A existed: a pre-flight that rejects what the database would happily accept, making
   * divisional Seasons impossible to create through the service at all.
   *
   * Normalised the same way the index normalises: a null division and an empty one are one value,
   * or "no division" and "" would be two different Season 1s.
   */
  const div = (division ?? '').trim()
  const clash = await prisma.season.findFirst({
    where: {
      competitionSeriesId,
      competitionYear,
      number,
      ...(div === '' ? { OR: [{ division: null }, { division: '' }] } : { division: div }),
      ...(exceptSeasonId != null ? { id: { not: exceptSeasonId } } : {}),
    },
    select: { id: true },
  })
  return clash != null
}

export interface NumberConflict {
  error: string
  /** What to offer instead, so the form can recover without the administrator re-deriving it. */
  suggestion: number
  /** The Season already holding this identity, so the caller can offer to open it. */
  existingSeasonId?: number | null
}

/** The message shown when a Competition/year/number is already spoken for. */
export async function conflictFor(
  competitionSeriesId: number,
  competitionYear: number,
  number: number,
  division?: string | null,
): Promise<NumberConflict> {
  const suggestion = await suggestSeasonNumber(competitionSeriesId, competitionYear)
  const div = (division ?? '').trim()
  /*
   * Name the record that already holds the number.
   *
   * "Season 1 already exists" leaves the reader to go and find it. Handing back its id lets the
   * caller offer to open it, which is almost always what somebody wants when they discover they are
   * recreating something that is already there.
   */
  const existing = await prisma.season.findFirst({
    where: {
      competitionSeriesId, competitionYear, number,
      ...(div === '' ? { OR: [{ division: null }, { division: '' }] } : { division: div }),
    },
    select: { id: true },
  })
  const where = div === '' ? 'this Competition' : `${div} of this Competition`
  return {
    error: `Season ${number} already exists for ${where} in ${competitionYear}. Try ${suggestion}, or pick another unused number.`,
    suggestion,
    existingSeasonId: existing?.id ?? null,
  }
}

/**
 * Is this the composite unique index rejecting a duplicate?
 *
 * The pre-flight check above closes the common case, but two administrators submitting at the same
 * instant can both pass it. The database index is the real authority, and this recognises its
 * complaint so the caller can answer with the same wording rather than a stack trace.
 */
export function isSeasonNumberCollision(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false
  const target = e.meta?.target
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')]
  const joined = fields.join(',')
  return joined.includes('number') || joined.includes('season_competition_year_number')
}
