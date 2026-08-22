'use server'

import { revalidatePath } from 'next/cache'

import { creatorActor } from './access'
import { createDraft, structuresForCreation, type StructureId } from './setup'

export interface CreateSeasonFormResult {
  ok?: boolean
  error?: string
  /** Where to continue: the Entrants stage of the new Season. */
  href?: string
  /** Set when the identity is already taken, so the form can offer to open that record instead. */
  existingHref?: string
}

/**
 * Create a Season from the Creator form.
 *
 * ── Access is not asked about ────────────────────────────────────────────────────────────────────
 * Every new Season is created OPEN and carries no join password. Whether anybody outside Creator may
 * actually enter it is decided by the site-wide policy and by the Season's lifecycle — one gate,
 * asked in one place. A per-Season password would be a second gate that has to agree with the first,
 * and two gates that can disagree is how a competition ends up closed to the people it was opened
 * for. Legacy password-protected Seasons keep their protection and their data; the mode is simply
 * not offered again.
 *
 * ── Structure is narrowed at the source ──────────────────────────────────────────────────────────
 * Only the two Groups → Playoffs shapes. `createDraft` validates against the same narrowed list, so
 * posting a retired structure by hand is refused too, rather than trusting the form's options.
 */
export async function createSeasonAction(input: {
  competitionYear: number
  competitionSeriesId: number
  structure: string
  number?: number | null
  division?: string | null
  title?: string | null
  description?: string | null
  idempotencyKey?: string | null
}): Promise<CreateSeasonFormResult> {
  const gate = await creatorActor()
  if (!gate.ok) return { error: gate.error }

  const allowed = structuresForCreation('season').map((s) => s.id as string)
  if (!allowed.includes(input.structure)) {
    return { error: 'Choose one of the Season structures on offer.' }
  }

  const created = await createDraft(gate.actor, {
    type: 'season',
    competitionYear: input.competitionYear,
    competitionSeriesId: input.competitionSeriesId,
    purpose: 'live',
    structure: input.structure as StructureId,
    number: input.number ?? null,
    division: input.division?.trim() || null,
    title: input.title?.trim() || null,
    description: input.description?.trim() || null,
    // The decision above, applied. No password is collected, so none can be required.
    accessMode: 'OPEN',
    joinPassword: null,
    idempotencyKey: input.idempotencyKey ?? null,
  })

  if (!created.ok || created.id == null) {
    return {
      error: created.error ?? 'The Season could not be created.',
      // Offer the record that already holds this identity rather than asking again.
      existingHref: created.existingSeasonId != null
        ? `/creator/seasons/${created.existingSeasonId}/entrants`
        : undefined,
    }
  }

  // The public overview exists the moment the record does.
  revalidatePath('/seasons')
  revalidatePath(`/seasons/${created.id}`)
  revalidatePath('/creator')
  revalidatePath('/creator/seasons')

  return { ok: true, href: `/creator/seasons/${created.id}/entrants` }
}
