'use server'

import { revalidatePath } from 'next/cache'
import { EditorialError } from './service'
import * as pages from './pages'
import { currentEditorialActor } from './permissions'

/**
 * Server actions for standalone pages.
 *
 * Administrator-only, and the service layer checks that itself on every call — these wrappers exist
 * to translate an expected refusal into a sentence and to refresh the right routes, not to decide
 * who may do what.
 */

export interface PageResult<T = void> {
  ok?: boolean
  error?: string
  data?: T
}

async function run<T>(fn: (actor: NonNullable<Awaited<ReturnType<typeof currentEditorialActor>>>) => Promise<T>): Promise<PageResult<T>> {
  try {
    const actor = await currentEditorialActor()
    if (!actor) return { error: 'Sign in with an active account to do that.' }
    return { ok: true, data: await fn(actor) }
  } catch (err) {
    if (err instanceof EditorialError) return { error: err.message }
    console.error('[editorial] page action failed', err)
    return { error: 'Something went wrong. Try again.' }
  }
}

/** Nav membership means the header changes, so the layout has to be refreshed as well as the page. */
function revalidatePages(slug?: string) {
  revalidatePath('/staff/news/pages')
  revalidatePath('/', 'layout')
  if (slug) revalidatePath(`/pages/${slug}`)
}

export async function createPageAction(input: pages.PageInput): Promise<PageResult<number>> {
  const res = await run((actor) => pages.createPage(actor, input))
  if (res.ok) revalidatePages(input.slug)
  return res
}

export async function updatePageAction(id: number, input: pages.PageInput): Promise<PageResult> {
  const res = await run((actor) => pages.updatePage(actor, id, input))
  if (res.ok) revalidatePages(input.slug)
  return res
}

export async function publishPageAction(id: number, publishAtIso?: string | null): Promise<PageResult> {
  const when = publishAtIso ? new Date(publishAtIso) : null
  if (when && Number.isNaN(when.getTime())) return { error: 'That publication time is not valid.' }
  const res = await run((actor) => pages.publishPage(actor, id, when))
  if (res.ok) revalidatePages()
  return res
}

export async function unpublishPageAction(id: number): Promise<PageResult> {
  const res = await run((actor) => pages.unpublishPage(actor, id))
  if (res.ok) revalidatePages()
  return res
}

export async function deletePageAction(id: number): Promise<PageResult> {
  const res = await run((actor) => pages.deletePage(actor, id))
  if (res.ok) revalidatePages()
  return res
}
