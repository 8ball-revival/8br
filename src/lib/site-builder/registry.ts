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
  /**
   * Where this container's children go. Only passed to modules that declare `container: true`.
   *
   * `<Slot />` renders every child in order; `<Slot index={0} />` renders one. A container decides
   * the arrangement and the renderer decides everything else — nesting, visibility, and the
   * per-module error handling that keeps one bad child from costing the page.
   */
  Slot?: React.ComponentType<{ index?: number; className?: string }>
}

export interface RenderContext {
  route: string
  seasonId?: number
  tournamentId?: number
  articleSlug?: string
  playerSlug?: string
  /**
   * The page's query string.
   *
   * System modules wrap the real functional surfaces — the rankings explorer, a bracket, the Yahoo
   * workspace — and every one of those keeps its entire state in the URL. Without this they would
   * have to be given a second, parallel state mechanism, and a filtered table would stop being
   * linkable. Passing the query through means the wrapped component behaves exactly as it did when
   * the page owned it.
   */
  searchParams?: Record<string, string | string[] | undefined>
  /** The dynamic route's params, so a system module knows which entity it is drawing. */
  routeParams?: Record<string, string>
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
  /*
    Level 1 is included because a system module that renders a whole page body legitimately owns the
    page's h1 — the Season page's title is the Season. Content modules stay at 2 and below, so a
    document with two h1s remains something the verification suite can flag.
  */
  a11y: { landmark?: boolean; headingLevel?: 1 | 2 | 3 | 4; requiresLabel?: boolean }

  /** Rendered on the public site and in the canvas alike. */
  Render: ComponentType<ModuleRenderProps<never>>

  /** True when this module legitimately owns an internal scroll area (a long table, a bracket). */
  ownsScroll?: boolean

  /**
   * This module holds other modules.
   *
   * A container's `Render` is given a `Slot` component and decides WHERE its children go — a split
   * panel puts them either side of its seam, a set of tabs puts one per panel. Declaring it here
   * rather than recognising container types by name means the validator, the editor's module tree
   * and the drop logic all agree without a shared list to keep in step.
   */
  container?: boolean

  /** How many children a container accepts. Undefined means no limit beyond the nesting cap. */
  maxChildren?: number

  /**
   * A module that IS the page.
   *
   * The rankings table on /rankings, the bracket on a Season's playoff view. An administrator may
   * move one, restyle it, or put content around it — but hiding or deleting one publishes a page
   * that no longer does its job, so the editor demands a typed confirmation first and the publish
   * validator reports it. The flag is what makes that possible without hard-coding a list of module
   * types into the editor.
   *
   * The string is what the warning says, in the administrator's terms.
   */
  essential?: string

  /**
   * Whether this module reads the query string.
   *
   * Only used to explain, in the palette, why a module cannot simply be dropped onto a different
   * page and behave the same way.
   */
  urlDriven?: boolean
}

// ── The registry ────────────────────────────────────────────────────────────────────────────────

const REGISTRY = new Map<string, ModuleDefinition>()

/**
 * Register a module.
 *
 * ── Duplicates are fatal in production, and a replacement in development ─────────────────────────
 * Two definitions claiming one type would mean whichever file happened to be imported second decided
 * how every existing instance renders — a difference that would surface only in production, so it is
 * a startup error there.
 *
 * In development the same condition is how HOT RELOAD looks. Editing a module file re-runs it, the
 * type is already registered, and throwing would abort the re-registration and leave the previous
 * definition in the map. The symptom is unpleasant to diagnose: the file on disk is correct, the
 * editor shows the new field, and the server keeps validating against the old schema until somebody
 * restarts it. So a re-registration replaces, which is what a reload means.
 */
export function registerModule<F extends FieldSet>(def: ModuleDefinition<F>): ModuleDefinition<F> {
  if (REGISTRY.has(def.type)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Site builder: two modules are registered as "${def.type}".`)
    }
    console.warn(`[site-builder] re-registering "${def.type}" (hot reload).`)
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

// ── Crossing to the client ──────────────────────────────────────────────────────────────────────

/**
 * A module definition with everything that cannot cross a serialisation boundary removed.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * The registry is populated by importing the module files, and those files import `next/image`,
 * Payload's media service and the canonical competition services — all server-only. So the client
 * bundle cannot import them, and the registry was simply EMPTY there: the inspector reported every
 * selected module as "unknown", and the palette had nothing to offer. Nothing failed loudly; the
 * editor just could not see the modules it was editing.
 *
 * Rather than splitting nineteen modules into paired definition/renderer files — which would put a
 * module's fields and its markup in different places for the rest of the project's life — the server
 * serialises what it already has and hands it to the editor as a prop. Field descriptors are pure
 * data by design, which is exactly what makes this possible.
 *
 * `Render` and `upgrade` are dropped because they are functions. The client never renders a module
 * (the server does) and never upgrades a config (the server does, on read), so neither is missed.
 */
export interface ModuleManifestEntry {
  type: string
  name: string
  category: ModuleCategory
  icon: string
  description: string
  configVersion: number
  fields: FieldSet
  layoutDefaults?: Partial<LayoutAtBreakpoint>
  dataDriven?: boolean
  ownsScroll?: boolean
  essential?: string
  urlDriven?: boolean
  container?: boolean
  maxChildren?: number
  a11y: ModuleDefinition['a11y']
}

export function serialiseRegistry(): ModuleManifestEntry[] {
  return allModules().map((m) => ({
    type: m.type,
    name: m.name,
    category: m.category,
    icon: m.icon,
    description: m.description,
    configVersion: m.configVersion,
    fields: m.fields,
    layoutDefaults: m.layoutDefaults,
    dataDriven: m.dataDriven,
    ownsScroll: m.ownsScroll,
    essential: m.essential,
    urlDriven: m.urlDriven,
    container: m.container,
    maxChildren: m.maxChildren,
    a11y: m.a11y,
  }))
}

/**
 * Populate the registry on the client from the serialised manifest.
 *
 * The placeholder renderer is never invoked: the client asks the registry for fields, names, icons
 * and categories, and the actual rendering happens on the server through the real definition. It
 * exists so that one `ModuleDefinition` shape serves both sides and every existing call site --
 * `createInstance`, `replaceModule`, `sharedFields`, the inspector, the palette -- keeps working
 * without knowing which side it is on.
 */
export function hydrateRegistry(entries: ModuleManifestEntry[]): void {
  for (const entry of entries) {
    REGISTRY.set(entry.type, {
      ...entry,
      Render: PLACEHOLDER_RENDERER,
    } as unknown as ModuleDefinition)
  }
}

const PLACEHOLDER_RENDERER = (() => null) as unknown as ModuleDefinition['Render']
