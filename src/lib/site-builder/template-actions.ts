'use server'

/**
 * The template surface the control centre and the template editor call.
 *
 * Every one begins with the capability check, for the same reason every other builder action does:
 * the client toggle is a convenience and never an authorisation. A template holds a layout that has
 * not been published anywhere, which is exactly the kind of thing that should not be readable by
 * somebody who cannot publish it.
 */

import { revalidatePath } from 'next/cache'

import { requireCapability } from '@/lib/competition/staff-auth'
import type { LayoutDocument } from './document'
import {
  createTemplate, deleteTemplate, duplicateTemplate, getTemplate, getTemplateRevisions,
  getTemplateUsage, listTemplates, rollbackTemplate, setTemplateArchived, updateTemplate,
  type TemplateDetail, type TemplateRevisionSummary, type TemplateScope, type TemplateUsage,
} from './templates'

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

/**
 * One place where a thrown error becomes a message.
 *
 * The message is the one the service wrote — "Give the template a name", "this layout cannot be
 * saved yet: …" — because those are written for the person reading them. Anything else becomes a
 * flat sentence rather than a stack trace, so a database fault cannot put a connection string in
 * front of an administrator.
 */
async function guarded<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    const safe = message && message.length < 300 && !/prisma|postgres|connect|ECONN/i.test(message)
      ? message
      : 'That could not be completed. Nothing was changed.'
    console.error('[site-builder] template action failed', err)
    return { ok: false, error: safe }
  }
}

export async function listTemplatesDetailAction(includeArchived = false): Promise<Result<TemplateDetail[]>> {
  return guarded(async () => {
    await requireCapability('manage_site_builder')
    return listTemplates({ includeArchived })
  })
}

export async function getTemplateAction(id: string): Promise<Result<TemplateDetail | null>> {
  return guarded(async () => {
    await requireCapability('manage_site_builder')
    return getTemplate(id)
  })
}

export async function createTemplateAction(input: {
  name: string
  scope: TemplateScope
  description?: string
  document?: LayoutDocument
}): Promise<Result<{ id: string }>> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const created = await createTemplate(input, actor)
    revalidatePath('/staff/site-builder')
    return created
  })
}

export async function updateTemplateAction(
  id: string,
  patch: {
    name?: string
    description?: string | null
    scope?: TemplateScope
    document?: LayoutDocument
    favorite?: boolean
    category?: string | null
  },
  summary?: string,
): Promise<Result<{ revisionNumber: number }>> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const result = await updateTemplate(id, patch, actor, summary)
    revalidatePath('/staff/site-builder')
    revalidatePath(`/staff/site-builder/templates/${id}`)
    return result
  })
}

export async function getTemplateRevisionsAction(id: string): Promise<Result<TemplateRevisionSummary[]>> {
  return guarded(async () => {
    await requireCapability('manage_site_builder')
    return getTemplateRevisions(id)
  })
}

export async function rollbackTemplateAction(id: string, revisionNumber: number): Promise<Result<{ revisionNumber: number }>> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const result = await rollbackTemplate(id, revisionNumber, actor)
    revalidatePath(`/staff/site-builder/templates/${id}`)
    revalidatePath('/staff/site-builder')
    return result
  })
}

export async function duplicateTemplateAction(id: string): Promise<Result<{ id: string }>> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    const created = await duplicateTemplate(id, actor)
    revalidatePath('/staff/site-builder')
    return created
  })
}

export async function setTemplateArchivedAction(id: string, archived: boolean): Promise<Result> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    await setTemplateArchived(id, archived, actor)
    revalidatePath('/staff/site-builder')
    return undefined
  })
}

export async function deleteTemplateAction(id: string): Promise<Result> {
  return guarded(async () => {
    const actor = await requireCapability('manage_site_builder')
    await deleteTemplate(id, actor)
    revalidatePath('/staff/site-builder')
    return undefined
  })
}

export async function getTemplateUsageAction(id: string): Promise<Result<TemplateUsage>> {
  return guarded(async () => {
    await requireCapability('manage_site_builder')
    return getTemplateUsage(id)
  })
}
