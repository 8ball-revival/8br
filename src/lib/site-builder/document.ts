/**
 * The layout document: what a page IS, once it is editable.
 *
 * A page is an ordered list of sections; a section is an ordered list of module instances plus the
 * grid that arranges them. That is the whole shape. Everything else — which ranking a panel shows,
 * what a heading says, how tall a panel is on a phone — lives inside a module's validated config or
 * its responsive layout, never in a special case here.
 *
 * ── Why the breakpoints inherit ──────────────────────────────────────────────────────────────────
 * Tablet and mobile hold PARTIAL overrides, not complete layouts. An administrator who nudges a
 * column width on desktop expects the phone to follow; an administrator who has deliberately set the
 * phone expects it to stay set. Storing three complete layouts cannot express the difference — the
 * moment tablet is written once it stops tracking desktop forever, silently. Storing only what was
 * overridden makes "inherited" a real state that can be seen in the inspector and reset.
 */

import { validateConfig, type ValidationIssue } from './fields'
import { getModule } from './registry'

// ── Breakpoints ─────────────────────────────────────────────────────────────────────────────────

export const BREAKPOINTS = ['desktop', 'tablet', 'mobile'] as const
export type Breakpoint = (typeof BREAKPOINTS)[number]

/** Grid columns available at each breakpoint. */
export const GRID_COLUMNS: Record<Breakpoint, number> = { desktop: 12, tablet: 8, mobile: 4 }

/** Pixel widths the preview switches at, and that the editor's device buttons emulate. */
export const BREAKPOINT_WIDTHS: Record<Breakpoint, number> = { desktop: 1440, tablet: 820, mobile: 390 }

// ── Style ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Style overrides, expressed as SCALE STEPS rather than free values.
 *
 * `padding: 4` means the fourth step of the site's spacing scale, not sixteen pixels. This is what
 * keeps a builder-made page looking like the rest of the site instead of like a page builder: an
 * administrator cannot invent a 13px gap that matches nothing, and when the scale is retuned every
 * page retunes with it. Colours are the same idea — a token reference or a hex that has been
 * contrast-checked, never an arbitrary CSS declaration.
 */
export interface StyleOverrides {
  paddingX?: number
  paddingY?: number
  gap?: number
  align?: 'start' | 'center' | 'end' | 'stretch'
  justify?: 'start' | 'center' | 'end' | 'between'
  background?: string
  backgroundMediaId?: number | null
  backgroundOverlay?: number
  border?: 'none' | 'thin' | 'strong' | 'accent'
  radius?: 'none' | 'clip' | 'sm' | 'md'
  shadow?: 'none' | 'soft' | 'glow'
  minHeight?: number
  textAlign?: 'left' | 'center' | 'right'
}

// ── Visibility ──────────────────────────────────────────────────────────────────────────────────

/**
 * A visibility rule, built from enumerated conditions.
 *
 * Every condition is a fixed operator over a fixed subject with an enumerated or scalar operand.
 * There is no expression to parse and nothing to evaluate, which is what keeps "hide this until the
 * season opens" from becoming a scripting surface.
 */
export type ConditionSubject =
  | 'dateWindow' | 'signedIn' | 'isAdmin' | 'device'
  | 'seasonStatus' | 'registrationOpen' | 'groupsPublished' | 'playoffsPublished'
  | 'competitionPlatform' | 'dataAvailable' | 'currentYear' | 'route'

export interface Condition {
  subject: ConditionSubject
  /** Enumerated operand, e.g. `'CUEVERSE'`, `'mobile'`, `'COMPLETED'`. */
  value?: string
  /** ISO instants for `dateWindow`. */
  from?: string | null
  to?: string | null
  negate?: boolean
}

export interface VisibilityRule {
  /** Hidden outright — the "temporarily hide" action, independent of any condition. */
  hidden?: boolean
  /** All conditions must hold. An empty list always shows. */
  conditions?: Condition[]
  /** Per-breakpoint visibility, independent of conditions. */
  hideOn?: Breakpoint[]
}

// ── Layout ──────────────────────────────────────────────────────────────────────────────────────

export interface LayoutAtBreakpoint {
  /** Grid columns this module spans. Omitted means inherited. */
  span?: number
  /** Explicit order within the section. Omitted means document order. */
  order?: number
  /** Rows spanned, for modules placed in a multi-row section. */
  rowSpan?: number
  /** Minimum height in spacing steps. */
  minHeight?: number
}

/**
 * Desktop is always complete; tablet and mobile are partial overlays on it.
 *
 * `resolveLayout` is the only thing that should read these directly, so the inheritance rule lives
 * in exactly one place.
 */
export interface ResponsiveLayout {
  desktop: LayoutAtBreakpoint
  tablet?: Partial<LayoutAtBreakpoint>
  mobile?: Partial<LayoutAtBreakpoint>
}

/** Flatten the overlay chain for one breakpoint. */
export function resolveLayout(layout: ResponsiveLayout, bp: Breakpoint): LayoutAtBreakpoint {
  if (bp === 'desktop') return layout.desktop
  if (bp === 'tablet') return { ...layout.desktop, ...(layout.tablet ?? {}) }
  // Mobile inherits through tablet, so a tablet override an administrator set is not skipped.
  return { ...layout.desktop, ...(layout.tablet ?? {}), ...(layout.mobile ?? {}) }
}

/** True when this breakpoint sets its own value for a property rather than inheriting one. */
export function isOverridden(layout: ResponsiveLayout, bp: Breakpoint, key: keyof LayoutAtBreakpoint): boolean {
  if (bp === 'desktop') return true
  return (layout[bp] ?? {})[key] !== undefined
}

// ── The document ────────────────────────────────────────────────────────────────────────────────

export interface ModuleInstance {
  id: string
  type: string
  configVersion: number
  config: Record<string, unknown>
  layout: ResponsiveLayout
  style: StyleOverrides
  visibility: VisibilityRule
  /** Set when this instance is synced to a reusable module; cleared when detached. */
  reusableId?: string | null
  /**
   * Modules nested inside this one.
   *
   * Only container modules — a grid, a stack, a split panel, a set of tabs — have children, and a
   * container declares itself in the registry rather than being recognised by name here. Everything
   * that walks the document recurses through this, which is why `findModule` returns a PATH rather
   * than an index: "the third module" stops being a location once a module can be inside another.
   *
   * Depth is capped at four during validation. Nothing about the layouts this site needs goes deeper
   * than a grid inside a split inside a section, and an uncapped tree is a stack overflow waiting
   * for an imported document to find it.
   */
  children?: ModuleInstance[]
}

export type SectionWidth = 'full' | 'wide' | 'narrow'

export interface Section {
  id: string
  name: string
  width: SectionWidth
  /**
   * Column ratios per breakpoint, e.g. `[58, 42]`.
   *
   * Ratios rather than pixel widths, and per breakpoint rather than one shared value, because the
   * homepage's existing 58/42 and 55/45 rows are ratios — reproducing them any other way would mean
   * the first published layout did not match the site it replaced.
   */
  columns: { desktop: number[]; tablet?: number[]; mobile?: number[] }
  style: StyleOverrides
  visibility: VisibilityRule
  modules: ModuleInstance[]
}

export interface LayoutDocument {
  version: number
  sections: Section[]
}

/** Bumped only when the document shape itself changes; module configs version independently. */
export const DOCUMENT_VERSION = 1

/** How deep containers may nest. See the note on `ModuleInstance.children`. */
export const MAX_NESTING_DEPTH = 4

export function emptyDocument(): LayoutDocument {
  return { version: DOCUMENT_VERSION, sections: [] }
}

// ── Validation ──────────────────────────────────────────────────────────────────────────────────

export interface DocumentValidation {
  ok: boolean
  issues: ValidationIssue[]
  /** The document with every module config validated, coerced and upgraded. */
  value: LayoutDocument
  /** Types referenced by the document that the registry does not know about. */
  unknownTypes: string[]
}

/**
 * Validate a whole document against the registry.
 *
 * This is the boundary. It runs on autosave, on manual save and again at publish, and nothing
 * reaches the database without passing through it. Two behaviours are deliberate:
 *
 *   - An UNKNOWN module type is reported but does not fail the document. A layout published before a
 *     module was renamed must still be openable and restorable; the instance survives as data and
 *     renders as a fallback rather than taking the page with it.
 *   - A module whose config is BEHIND the registry is upgraded through its own `upgrade` function
 *     before validation, so an old revision opens as the current schema rather than as an error.
 */
export function validateDocument(input: unknown): DocumentValidation {
  const issues: ValidationIssue[] = []
  const unknownTypes: string[] = []
  const doc = (input && typeof input === 'object') ? input as Partial<LayoutDocument> : {}
  const sectionsIn = Array.isArray(doc.sections) ? doc.sections : []
  const seenIds = new Set<string>()

  const sections: Section[] = sectionsIn.map((rawSection, si) => {
    const s = (rawSection && typeof rawSection === 'object') ? rawSection as Partial<Section> : {}
    const path = `sections.${si}`
    const id = uniqueId(String(s.id ?? ''), seenIds, `section-${si}`)
    const modulesIn = Array.isArray(s.modules) ? s.modules : []

    const validateModule = (rawModule: unknown, mi: number, path: string, depth: number): ModuleInstance => {
      const m = (rawModule && typeof rawModule === 'object') ? rawModule as Partial<ModuleInstance> : {}
      const mPath = `${path}.modules.${mi}`
      const type = String(m.type ?? '')
      const def = getModule(type)
      const mid = uniqueId(String(m.id ?? ''), seenIds, `module-${si}-${mi}`)

      /*
        Children are validated first, at one greater depth.

        Past the cap they are DROPPED rather than the module being rejected: a document that nested
        too deeply is a document somebody built or imported, and losing the deepest layer is far
        kinder than losing the page. The drop is reported as an issue so it is not silent.
      */
      const rawChildren = Array.isArray(m.children) ? m.children : []
      let children: ModuleInstance[] | undefined
      if (rawChildren.length) {
        if (depth >= MAX_NESTING_DEPTH) {
          issues.push({ path: `${mPath}.children`, message: `Nested deeper than ${MAX_NESTING_DEPTH} levels; the inner modules were dropped.` })
        } else {
          children = rawChildren.map((c, ci) => validateModule(c, ci, `${mPath}.children`, depth + 1))
        }
      }

      if (!def) {
        // Preserved verbatim. Dropping it here would silently delete an administrator's module the
        // first time a registry key changed, and the fallback renderer exists precisely so that
        // does not have to happen.
        if (!unknownTypes.includes(type)) unknownTypes.push(type)
        return {
          id: mid,
          type,
          configVersion: Number(m.configVersion ?? 0),
          config: (m.config && typeof m.config === 'object') ? m.config as Record<string, unknown> : {},
          layout: normaliseLayout(m.layout),
          style: normaliseStyle(m.style),
          visibility: normaliseVisibility(m.visibility),
          reusableId: m.reusableId ?? null,
          children,
        }
      }

      const storedVersion = Number(m.configVersion ?? def.configVersion)
      const rawConfig = (m.config && typeof m.config === 'object') ? m.config as Record<string, unknown> : {}
      const upgraded = storedVersion < def.configVersion && def.upgrade
        ? def.upgrade(rawConfig, storedVersion)
        : rawConfig

      const result = validateConfig(def.fields, upgraded, `${mPath}.config`)
      if (!result.ok) issues.push(...result.issues)

      return {
        id: mid,
        type,
        configVersion: def.configVersion,
        /*
          ALWAYS the validated value, including when validation failed.

          This used to fall back to the raw config on failure, which meant a module with one bad
          field had its ENTIRE untrusted config written to the database — and a `javascript:` href
          in a button reached storage that way. `validateConfig` now returns a usable value in both
          cases, with failing fields at their defaults, so there is no longer a branch where the
          unsafe value is the one that gets kept.
        */
        config: result.value as Record<string, unknown>,
        layout: normaliseLayout(m.layout, def.layoutDefaults),
        style: normaliseStyle(m.style),
        visibility: normaliseVisibility(m.visibility),
        reusableId: m.reusableId ?? null,
        // Only a container keeps children. A non-container that somehow carried them would render
        // nothing for them, so they are dropped rather than kept as invisible data.
        children: def.container ? children : undefined,
      }
    }

    const modules: ModuleInstance[] = modulesIn.map((raw, mi) => validateModule(raw, mi, path, 0))

    return {
      id,
      name: String(s.name ?? `Section ${si + 1}`).slice(0, 80).replace(/[<>]/g, ''),
      width: (['full', 'wide', 'narrow'] as const).includes(s.width as SectionWidth) ? s.width as SectionWidth : 'wide',
      columns: normaliseColumns(s.columns, modules.length),
      style: normaliseStyle(s.style),
      visibility: normaliseVisibility(s.visibility),
      modules,
    }
  })

  return {
    ok: issues.length === 0,
    issues,
    value: { version: DOCUMENT_VERSION, sections },
    unknownTypes,
  }
}

/**
 * Ids must be unique across the whole document.
 *
 * They are React keys, drag targets, selection handles and undo anchors all at once. A duplicate id
 * — which is exactly what "duplicate this module" produces if it copies naively — makes the editor
 * select or move the wrong element, and that is far harder to diagnose than a renamed id.
 */
function uniqueId(candidate: string, seen: Set<string>, fallback: string): string {
  let id = /^[a-zA-Z0-9_-]{1,64}$/.test(candidate) ? candidate : fallback
  while (seen.has(id)) id = `${id}-${seen.size}`
  seen.add(id)
  return id
}

function normaliseColumns(input: unknown, moduleCount: number): Section['columns'] {
  const clean = (v: unknown): number[] | undefined => {
    if (!Array.isArray(v) || v.length === 0) return undefined
    const nums = v.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    return nums.length ? nums.slice(0, 12) : undefined
  }
  const c = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
  // One equal column per module is the honest default for a section that never declared a grid:
  // it renders every module rather than collapsing them into one column.
  return {
    desktop: clean(c.desktop) ?? Array.from({ length: Math.max(1, moduleCount) }, () => 1),
    tablet: clean(c.tablet),
    mobile: clean(c.mobile),
  }
}

function normaliseLayout(input: unknown, defaults?: Partial<LayoutAtBreakpoint>): ResponsiveLayout {
  const l = (input && typeof input === 'object') ? input as Partial<ResponsiveLayout> : {}
  const at = (v: unknown): Partial<LayoutAtBreakpoint> | undefined => {
    if (!v || typeof v !== 'object') return undefined
    const o = v as Record<string, unknown>
    const out: Partial<LayoutAtBreakpoint> = {}
    if (o.span !== undefined) out.span = clamp(Number(o.span), 1, 12)
    if (o.order !== undefined) out.order = clamp(Number(o.order), 0, 999)
    if (o.rowSpan !== undefined) out.rowSpan = clamp(Number(o.rowSpan), 1, 6)
    if (o.minHeight !== undefined) out.minHeight = clamp(Number(o.minHeight), 0, 200)
    return Object.keys(out).length ? out : undefined
  }
  return {
    desktop: { span: 1, ...defaults, ...(at(l.desktop) ?? {}) },
    tablet: at(l.tablet),
    mobile: at(l.mobile),
  }
}

function normaliseStyle(input: unknown): StyleOverrides {
  if (!input || typeof input !== 'object') return {}
  const o = input as Record<string, unknown>
  const out: StyleOverrides = {}
  const step = (v: unknown) => (v === undefined ? undefined : clamp(Number(v), 0, 24))
  if (o.paddingX !== undefined) out.paddingX = step(o.paddingX)
  if (o.paddingY !== undefined) out.paddingY = step(o.paddingY)
  if (o.gap !== undefined) out.gap = step(o.gap)
  if (o.minHeight !== undefined) out.minHeight = clamp(Number(o.minHeight), 0, 200)
  if (o.backgroundOverlay !== undefined) out.backgroundOverlay = clamp(Number(o.backgroundOverlay), 0, 100)
  if (o.backgroundMediaId !== undefined) {
    const n = Number(o.backgroundMediaId)
    out.backgroundMediaId = Number.isInteger(n) && n > 0 ? n : null
  }
  // Colours accept only a token reference or a hex value; an arbitrary CSS string here would be a
  // declaration injected into a style attribute.
  if (typeof o.background === 'string' && (/^#[0-9a-fA-F]{3,8}$/.test(o.background) || /^var\(--[a-z0-9-]+\)$/.test(o.background))) {
    out.background = o.background
  }
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
    (typeof v === 'string' && (allowed as readonly string[]).includes(v)) ? v as T : undefined
  out.align = oneOf(o.align, ['start', 'center', 'end', 'stretch'] as const)
  out.justify = oneOf(o.justify, ['start', 'center', 'end', 'between'] as const)
  out.border = oneOf(o.border, ['none', 'thin', 'strong', 'accent'] as const)
  out.radius = oneOf(o.radius, ['none', 'clip', 'sm', 'md'] as const)
  out.shadow = oneOf(o.shadow, ['none', 'soft', 'glow'] as const)
  out.textAlign = oneOf(o.textAlign, ['left', 'center', 'right'] as const)
  for (const k of Object.keys(out) as (keyof StyleOverrides)[]) {
    if (out[k] === undefined) delete out[k]
  }
  return out
}

const CONDITION_SUBJECTS: ConditionSubject[] = [
  'dateWindow', 'signedIn', 'isAdmin', 'device', 'seasonStatus', 'registrationOpen',
  'groupsPublished', 'playoffsPublished', 'competitionPlatform', 'dataAvailable', 'currentYear', 'route',
]

function normaliseVisibility(input: unknown): VisibilityRule {
  if (!input || typeof input !== 'object') return {}
  const o = input as Record<string, unknown>
  const out: VisibilityRule = {}
  if (o.hidden === true) out.hidden = true
  if (Array.isArray(o.hideOn)) {
    const bps = o.hideOn.filter((b): b is Breakpoint => (BREAKPOINTS as readonly string[]).includes(String(b)))
    if (bps.length) out.hideOn = bps
  }
  if (Array.isArray(o.conditions)) {
    const conds = o.conditions
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .filter((c) => CONDITION_SUBJECTS.includes(String(c.subject) as ConditionSubject))
      .slice(0, 12)
      .map((c) => {
        const cond: Condition = { subject: String(c.subject) as ConditionSubject }
        if (typeof c.value === 'string') cond.value = c.value.slice(0, 64)
        if (typeof c.from === 'string' && !Number.isNaN(Date.parse(c.from))) cond.from = c.from
        if (typeof c.to === 'string' && !Number.isNaN(Date.parse(c.to))) cond.to = c.to
        if (c.negate === true) cond.negate = true
        return cond
      })
    if (conds.length) out.conditions = conds
  }
  return out
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.round(n)))
}
