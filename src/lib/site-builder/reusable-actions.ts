'use server'

/**
 * Reading and using reusable modules and templates.
 *
 * Kept apart from `actions.ts` so the editor can list them without pulling the whole write surface
 * into its import graph. Every one still begins with the capability check.
 */

import { revalidatePath } from 'next/cache'

import { requireCapability } from '@/lib/competition/staff-auth'
import { recordAudit } from '@/lib/competition/audit'
import { prisma } from '@/lib/prisma'
import { validateDocument } from './document'
import type { LayoutDocument } from './document'

export interface ReusableSummary {
  id: string
  name: string
  moduleType: string
  config: Record<string, unknown>
  version: number
  updatedAt: string
}

export async function listReusablesAction(): Promise<
  { ok: true; data: ReusableSummary[] } | { ok: false; error: string }
> {
  try {
    await requireCapability('manage_site_builder')
    const rows = await prisma.siteReusableModule.findMany({
      where: { archivedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })
    return {
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        moduleType: r.moduleType,
        config: r.config as Record<string, unknown>,
        version: r.version,
        updatedAt: r.updatedAt.toISOString(),
      })),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not read the reusable modules.' }
  }
}

export interface TemplateSummary {
  id: string
  name: string
  scope: string
  document: LayoutDocument
  updatedAt: string
}

export async function listTemplatesAction(): Promise<
  { ok: true; data: TemplateSummary[] } | { ok: false; error: string }
> {
  try {
    await requireCapability('manage_site_builder')
    const rows = await prisma.siteTemplate.findMany({ where: { archivedAt: null }, orderBy: { updatedAt: 'desc' }, take: 100 })
    return {
      ok: true,
      data: rows.map((t) => ({
        id: t.id,
        name: t.name,
        scope: t.scope,
        // Validated on the way out: a template stored before a module changed must not be able to
        // put an invalid config onto a page.
        document: validateDocument(t.document).value,
        updatedAt: t.updatedAt.toISOString(),
      })),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not read the templates.' }
  }
}

/**
 * Update a reusable module, and tell the caller how many pages follow it.
 *
 * The count is deliberately returned rather than acted on. A change to a linked module reaches every
 * page that uses it, and those pages each need publishing — silently republishing all of them from
 * here would be the single most surprising thing this system could do.
 */
export async function updateReusableAction(
  id: string,
  config: Record<string, unknown>,
): Promise<{ ok: true; data: { usedOnPages: string[] } } | { ok: false; error: string }> {
  try {
    const actor = await requireCapability('manage_site_builder')
    const existing = await prisma.siteReusableModule.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: 'That reusable module no longer exists.' }

    await prisma.siteReusableModule.update({
      where: { id },
      data: { config: config as never, version: { increment: 1 } },
    })
    await recordAudit(actor, {
      action: 'site_builder.reusable_update',
      entity: 'SiteReusableModule',
      entityId: id,
      oldValue: { version: existing.version },
      newValue: { version: existing.version + 1 },
    })

    // Which pages carry an instance linked to this one. A JSON scan is fine at this size and avoids
    // a second table that would need keeping in step with every move and delete.
    const pages = await prisma.sitePage.findMany({ include: { draft: true } })
    const usedOnPages = pages
      .filter((p) => JSON.stringify(p.draft?.document ?? '').includes(`"reusableId":"${id}"`))
      .map((p) => p.title)

    revalidatePath('/staff/site-builder')
    return { ok: true, data: { usedOnPages } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update the reusable module.' }
  }
}

export async function deleteReusableAction(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const actor = await requireCapability('manage_site_builder')
    // Archived, never deleted: instances still reference it, and a hard delete would leave them
    // pointing at nothing with no way to explain what happened.
    await prisma.siteReusableModule.update({ where: { id }, data: { archivedAt: new Date() } })
    await recordAudit(actor, { action: 'site_builder.reusable_archive', entity: 'SiteReusableModule', entityId: id })
    revalidatePath('/staff/site-builder')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not archive it.' }
  }
}
