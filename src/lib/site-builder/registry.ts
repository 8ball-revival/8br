/**
 * The module registry: the list of things an administrator is allowed to put on a page.
 *
 * A module type is a contract, not a component. Registering one declares what it can be configured
 * with, what it defaults to, how an older config becomes a current one, and how it renders — and the
 * registry is what the validator, the inspector, the palette and the renderer all read. Nothing
 * about a module is described in more than one place, which is what stops the editor offering an
 * option the server rejects.
 *
 * ── One renderer ─────────────────────────────────────────────────────────────────────────────────
 * `Render` is used by the public page AND by the editing canvas. There is deliberately no separate
 * preview implementation: a preview that is a second rendering path is a preview that will
 * eventually disagree with what publishes, and the whole value of editing in place is that it
 * cannot.
 *
 * ── Categories ───────────────────────────────────────────────────────────────────────────────────
 * The palette groups by category, so a category is part of the contract rather than a display
 * detail. They are ordered by how often they are reached for, not alphabetically.
 */

import type { ComponentType } from 'react'
import type { FieldSet } from './fields'
import type { LayoutAtBreakpoint, ModuleInstance } from './document'

export const MODULE_CATEGORIES = [
  'layout',
  'content',
  'editorial',
  'competitions',
  'rankings',
  'seasons',
  'global',
] as const
export type ModuleCategory = (typeof MODULE_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<ModuleCategory, string> = {
  layout: 'Foundation & Layout',
  content: 'Content',
  editorial: 'Editorial',
  competitions: 'Competitions',
  rankings: 'Rankings & Records',
  seasons: 'Season & Tournament Data',
  global: 'Global',
}

/**
 * What a module receives when it renders.
 *
 * `editing` is passed so a module can soften an interaction that would fight the canvas — a carousel
 * that auto-advances, a link that would navigate away mid-selection. It must NOT be used to change
 * what the module looks like, because then the preview would stop being the published result.
 */
export interface ModuleRenderProps<C = Record<string, unknown>> {
  config: C
  instance: ModuleInstance
  editing: boolean
  /** Route context, so a module on a dynamic template knows which entity it is rendering for. */
  context: RenderContext
}

export interface RenderContext {
  route: string
  seasonId?: number
  tournamentId?: number
  articleSlug?: string
  playerSlug?: string
  /** Signed-in viewer, for visibility conditions only — never for authorization. */
  viewer?: { signedIn: boolean; isAdmin: boolean }
}

export interface ModuleDefinition<F extends FieldSet = FieldSet> {
  /** Stable identifier. Persisted in every document, so it is renamed only with a migration. */
  type: string
  name: string
  category: ModuleCategory
  /** lucide-react icon name, resolved by the palette. */
  icon: string
  description: string

  /** Bumped whenever `fields` changes shape. Drives `upgrade`. */
  configVersion: number
  fields: F

  /** Grid behaviour a fresh instance starts with. */
  layoutDefaults?: Partial<LayoutAtBreakpoint>

  /**
   * Bring a config written for an older `configVersion` up to date.
   *
   * Without this, changing a field means every page that already uses the module renders wrong or
   * refuses to open — including published revisions an administrator may need to roll back to.
   */
  upgrade?: (config: Record<string, unknown>, fromVersion: number) => Record<string, unknown>

  /** Whether this module reads competition data, so the palette can mark it and batching can group it. */
  dataDriven?: boolean

  /**
   * Accessibility contract. Enforced by the verification suite rather than by convention: a module
   * that renders a region must name it, and one that renders a heading must say what level it is.
   */
  a11y: { landmark?: boolean; headingLevel?: 2 | 3 | 4; requiresLabel?: boolean }

  /** Rendered on the public site and in the canvas alike. */
  Render: ComponentType<ModuleRenderProps<never>>

  /** True when this module legitimately owns an internal scroll area (a long table, a bracket). */
  ownsScroll?: boolean
}

// ── The registry ────────────────────────────────────────────────────────────────────────────────

const REGISTRY = new Map<string, ModuleDefinition>()

/**
 * Register a module.
 *
 * Duplicate types throw at import time rather than silently replacing. Two definitions claiming one
 * type would mean whichever module file happened to be imported second decided how every existing
 * instance renders — a difference that would only show up in production.
 */
export function registerModule<F extends FieldSet>(def: ModuleDefinition<F>): ModuleDefinition<F> {
  if (REGISTRY.has(def.type)) {
    throw new Error(`Site builder: two modules are registered as "${def.type}".`)
  }
  REGISTRY.set(def.type, def as unknown as ModuleDefinition)
  return def
}

export function getModule(type: string): ModuleDefinition | undefined {
  return REGISTRY.get(type)
}

export function allModules(): ModuleDefinition[] {
  return [...REGISTRY.values()]
}

export function modulesByCategory(): { category: ModuleCategory; label: string; modules: ModuleDefinition[] }[] {
  return MODULE_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    modules: allModules()
      .filter((m) => m.category === category)
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((g) => g.modules.length > 0)
}

/**
 * Modules that can stand in for this one when Replace is used.
 *
 * Same category is the rule, because category is already "things that do the same job in the same
 * place" — a ranking panel can become a different ranking panel, and an announcement can become a
 * different announcement, but neither should silently become a footer.
 */
export function replacementsFor(type: string): ModuleDefinition[] {
  const def = getModule(type)
  if (!def) return []
  return allModules()
    .filter((m) => m.category === def.category && m.type !== type)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Config fields two modules share by name AND kind.
 *
 * Replace carries these across, which is what makes it feel like changing a panel rather than
 * deleting one and building another. Matching on kind as well as name matters: two modules can both
 * have `limit`, one a number and one a select, and carrying a number into a select would produce a
 * config the validator then rejects.
 */
export function sharedFields(fromType: string, toType: string): string[] {
  const a = getModule(fromType)
  const b = getModule(toType)
  if (!a || !b) return []
  return Object.keys(a.fields).filter((k) => k in b.fields && a.fields[k].kind === b.fields[k].kind)
}
