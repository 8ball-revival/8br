/**
 * Every structural edit, as a pure function from document to document.
 *
 * ── Why these are pure, and why that is the whole design ─────────────────────────────────────────
 * Undo is not implemented as an inverse of each operation. It is a stack of documents: apply an
 * operation, push the result, and undo is `pop`. That only works if operations never mutate what
 * they are given — one accidental in-place `splice` and the previous entry on the stack silently
 * becomes the current one, so undo appears to do nothing. It is a bug that is very hard to see and
 * trivial to prevent, which is why every function here clones before it edits.
 *
 * It also means the operations can be tested without a browser, a database or React, which is how
 * the verification suite exercises move, resize, duplicate, replace and delete.
 *
 * No function here validates. Validation is the server's boundary and runs on every save; doing it
 * again here would mean two implementations of the same rules, and the one in the editor would be
 * the one that drifted.
 */

import type {
  Breakpoint, LayoutAtBreakpoint, LayoutDocument, ModuleInstance, Section, StyleOverrides, VisibilityRule,
} from './document'
import { getModule, sharedFields } from './registry'
import { defaultsFor } from './fields'

// ── Ids ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * A new id.
 *
 * `crypto.randomUUID` is available in the browser and in Node, but not in every older embedded
 * runtime, so there is a fallback. Ids only need to be unique within one document — they are React
 * keys and drag anchors, not global identifiers — so the fallback's weaker randomness is fine.
 */
export function newId(prefix = 'm'): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${rand}`
}

const clone = <T,>(v: T): T => structuredClone(v)

// ── Finding things ──────────────────────────────────────────────────────────────────────────────

export interface ModuleLocation {
  sectionIndex: number
  /** Index within its immediate list — the section's modules, or a container's children. */
  moduleIndex: number
  section: Section
  module: ModuleInstance
  /** The container it sits in, or null when it sits directly in the section. */
  parent: ModuleInstance | null
  /** The list it actually belongs to, so callers can splice without re-deriving it. */
  siblings: ModuleInstance[]
  /** Ids from the outermost container down to this module's parent. */
  ancestors: string[]
}

/**
 * Find a module anywhere in the document, including inside containers.
 *
 * Returns the LIST it belongs to rather than only an index, because once a module can be inside
 * another "the third module of section two" stops being a location. Every operation below splices
 * `siblings`, so none of them needs to know how deep it was.
 */
export function findModule(doc: LayoutDocument, moduleId: string): ModuleLocation | null {
  for (let s = 0; s < doc.sections.length; s++) {
    const section = doc.sections[s]
    const found = search(section.modules, null, [])
    if (found) return { ...found, sectionIndex: s, section }
  }
  return null

  function search(
    list: ModuleInstance[],
    parent: ModuleInstance | null,
    ancestors: string[],
  ): Omit<ModuleLocation, 'sectionIndex' | 'section'> | null {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === moduleId) {
        return { moduleIndex: i, module: list[i], parent, siblings: list, ancestors }
      }
      const kids = list[i].children
      if (kids?.length) {
        const deeper = search(kids, list[i], [...ancestors, list[i].id])
        if (deeper) return deeper
      }
    }
    return null
  }
}

/** Every module in the document, outermost first, with the depth it sits at. */
export function walkModules(doc: LayoutDocument): { module: ModuleInstance; sectionId: string; depth: number; parentId: string | null }[] {
  const out: { module: ModuleInstance; sectionId: string; depth: number; parentId: string | null }[] = []
  for (const section of doc.sections) {
    const visit = (list: ModuleInstance[], depth: number, parentId: string | null) => {
      for (const m of list) {
        out.push({ module: m, sectionId: section.id, depth, parentId })
        if (m.children?.length) visit(m.children, depth + 1, m.id)
      }
    }
    visit(section.modules, 0, null)
  }
  return out
}

export function findSection(doc: LayoutDocument, sectionId: string): { index: number; section: Section } | null {
  const index = doc.sections.findIndex((s) => s.id === sectionId)
  return index === -1 ? null : { index, section: doc.sections[index] }
}

// ── Modules ─────────────────────────────────────────────────────────────────────────────────────

export function createInstance(type: string, overrides: Partial<ModuleInstance> = {}): ModuleInstance {
  const def = getModule(type)
  return {
    id: newId(),
    type,
    configVersion: def?.configVersion ?? 1,
    config: def ? defaultsFor(def.fields) as Record<string, unknown> : {},
    layout: { desktop: { span: 1, ...(def?.layoutDefaults ?? {}) } },
    style: {},
    visibility: {},
    reusableId: null,
    ...overrides,
  }
}

/**
 * Insert a module into a section, or into a container inside one.
 *
 * `intoModuleId` names a container to nest inside. It is checked against the document rather than
 * trusted: dropping a module into something that is not a container would create children nothing
 * renders, which is invisible until somebody wonders where their module went.
 */
export function insertModule(
  doc: LayoutDocument, sectionId: string, instance: ModuleInstance, at?: number, intoModuleId?: string,
): LayoutDocument {
  const next = clone(doc)

  if (intoModuleId) {
    const host = findModule(next, intoModuleId)
    if (!host) return doc
    const def = getModule(host.module.type)
    if (!def?.container) return doc
    host.module.children = host.module.children ?? []
    if (def.maxChildren !== undefined && host.module.children.length >= def.maxChildren) return doc
    const index = at ?? host.module.children.length
    host.module.children.splice(Math.max(0, Math.min(index, host.module.children.length)), 0, instance)
    return next
  }

  const found = findSection(next, sectionId)
  if (!found) return doc
  const index = at ?? found.section.modules.length
  found.section.modules.splice(Math.max(0, Math.min(index, found.section.modules.length)), 0, instance)
  syncColumns(found.section)
  return next
}

export function removeModule(doc: LayoutDocument, moduleId: string): LayoutDocument {
  const next = clone(doc)
  const found = findModule(next, moduleId)
  if (!found) return doc
  found.siblings.splice(found.moduleIndex, 1)
  // Column syncing only applies to a section's own row of modules; a container manages its own.
  if (!found.parent) syncColumns(next.sections[found.sectionIndex])
  return next
}

/**
 * Duplicate, with a fresh id.
 *
 * Reusing the id would be the natural-looking thing to do and would break selection, drag targeting
 * and React reconciliation all at once — two elements answering to one id means the editor acts on
 * whichever it finds first. The copy is also DETACHED from any reusable module: a duplicate is a
 * new thing, and leaving it synced would mean editing the copy silently edited the original
 * everywhere it appears.
 */
export function duplicateModule(doc: LayoutDocument, moduleId: string): LayoutDocument {
  const found = findModule(doc, moduleId)
  if (!found) return doc
  // Fresh ids all the way down. A duplicated container whose children kept their ids would give the
  // document two modules answering to one id, and selection would act on whichever it found first.
  const copy = reidentify(clone(found.module))
  copy.reusableId = null
  return insertModule(doc, found.section.id, copy, found.moduleIndex + 1, found.parent?.id)
}

/** Give a module and everything inside it new ids. */
function reidentify(m: ModuleInstance): ModuleInstance {
  return {
    ...m,
    id: newId(),
    children: m.children?.map(reidentify),
  }
}

/**
 * Move a module, within a section or between sections.
 *
 * `toIndex` is interpreted in the list AFTER the module has been removed, which is what makes
 * "move down by one" work. Interpreting it against the original list means a downward move by one
 * lands the module back where it started, and the button looks broken.
 */
export function moveModule(
  doc: LayoutDocument, moduleId: string, toSectionId: string, toIndex: number, intoModuleId?: string,
): LayoutDocument {
  const next = clone(doc)
  const found = findModule(next, moduleId)
  if (!found) return doc

  // A container cannot be moved inside itself or its own descendants. Without this check the moved
  // subtree is spliced out and then re-inserted into a list that no longer exists in the document,
  // and the module disappears.
  if (intoModuleId) {
    if (intoModuleId === moduleId) return doc
    const target = findModule(next, intoModuleId)
    if (!target) return doc
    if (target.ancestors.includes(moduleId)) return doc
    const def = getModule(target.module.type)
    if (!def?.container) return doc
  }

  const [instance] = found.siblings.splice(found.moduleIndex, 1)

  if (intoModuleId) {
    const host = findModule(next, intoModuleId)
    if (!host) return doc
    host.module.children = host.module.children ?? []
    host.module.children.splice(Math.max(0, Math.min(toIndex, host.module.children.length)), 0, instance)
    if (!found.parent) syncColumns(next.sections[found.sectionIndex])
    return next
  }

  const target = findSection(next, toSectionId)
  if (!target) return doc
  target.section.modules.splice(Math.max(0, Math.min(toIndex, target.section.modules.length)), 0, instance)
  if (!found.parent) syncColumns(next.sections[found.sectionIndex])
  if (target.section.id !== found.section.id) syncColumns(target.section)
  return next
}

/** Nudge one place in either direction, for keyboard reordering. */
export function nudgeModule(doc: LayoutDocument, moduleId: string, delta: -1 | 1): LayoutDocument {
  const found = findModule(doc, moduleId)
  if (!found) return doc
  const target = found.moduleIndex + delta

  // Inside a container, nudging moves within that container and stops at its edges. Stepping out of
  // one by pressing an arrow key would be a surprise; "move out" is its own action.
  if (found.parent) {
    if (target < 0 || target >= found.siblings.length) return doc
    return moveModule(doc, moduleId, found.section.id, target, found.parent.id)
  }

  if (target < 0 || target >= found.section.modules.length) {
    // Past the end of a section, move into the neighbouring one. Without this, keyboard users can
    // reorder within a section but can never move a module out of it.
    const sectionDelta = delta
    const nextSection = doc.sections[found.sectionIndex + sectionDelta]
    if (!nextSection) return doc
    return moveModule(doc, moduleId, nextSection.id, delta === 1 ? 0 : nextSection.modules.length)
  }
  return moveModule(doc, moduleId, found.section.id, target)
}

export function updateModuleConfig(
  doc: LayoutDocument, moduleId: string, patch: Record<string, unknown>,
): LayoutDocument {
  const next = clone(doc)
  const found = findModule(next, moduleId)
  if (!found) return doc
  found.module.config = { ...found.module.config, ...patch }
  return next
}

export function updateModuleStyle(doc: LayoutDocument, moduleId: string, patch: StyleOverrides): LayoutDocument {
  const next = clone(doc)
  const found = findModule(next, moduleId)
  if (!found) return doc
  found.module.style = { ...found.module.style, ...patch }
  return next
}

export function updateModuleVisibility(doc: LayoutDocument, moduleId: string, patch: VisibilityRule): LayoutDocument {
  const next = clone(doc)
  const found = findModule(next, moduleId)
  if (!found) return doc
  found.module.visibility = { ...found.module.visibility, ...patch }
  return next
}

/**
 * Set a layout value at one breakpoint.
 *
 * Passing `undefined` CLEARS the override, which is how "reset to inherited" works. Desktop cannot
 * be cleared, because something has to be the base for the other two to inherit from.
 */
export function setLayout(
  doc: LayoutDocument, moduleId: string, bp: Breakpoint, key: keyof LayoutAtBreakpoint, value: number | undefined,
): LayoutDocument {
  const next = clone(doc)
  const found = findModule(next, moduleId)
  if (!found) return doc
  if (bp === 'desktop') {
    if (value === undefined) return doc
    found.module.layout.desktop = { ...found.module.layout.desktop, [key]: value }
    return next
  }
  const current = { ...(found.module.layout[bp] ?? {}) }
  if (value === undefined) delete current[key]
  else current[key] = value
  found.module.layout[bp] = Object.keys(current).length ? current : undefined
  return next
}

/**
 * Swap one module type for another, keeping everything that still makes sense.
 *
 * Placement, dimensions, responsive visibility and style are all properties of the SLOT rather than
 * of the module, so they survive. Config fields survive only when both modules have a field of the
 * same name AND the same kind — matching on name alone would carry a number into a select and
 * produce a config the validator then rejects, which would look like Replace corrupting the page.
 */
export function replaceModule(doc: LayoutDocument, moduleId: string, toType: string): LayoutDocument {
  const found = findModule(doc, moduleId)
  if (!found) return doc
  const def = getModule(toType)
  if (!def) return doc

  const carried: Record<string, unknown> = {}
  for (const key of sharedFields(found.module.type, toType)) {
    carried[key] = clone(found.module.config[key])
  }

  const next = clone(doc)
  const target = findModule(next, moduleId)
  if (!target) return doc
  // Children survive only when the replacement can hold them. Carrying them into a non-container
  // would keep them as data nothing renders.
  const keptChildren = def.container ? clone(found.module.children) : undefined
  target.siblings[target.moduleIndex] = {
    // A NEW id: the old module is a different thing, and keeping the id would make undo and the
    // trash entry ambiguous about which of the two they refer to.
    id: newId(),
    type: toType,
    configVersion: def.configVersion,
    config: { ...defaultsFor(def.fields), ...carried } as Record<string, unknown>,
    layout: clone(found.module.layout),
    style: clone(found.module.style),
    visibility: clone(found.module.visibility),
    reusableId: null,
    children: keptChildren,
  }
  return next
}

// ── Sections ────────────────────────────────────────────────────────────────────────────────────

export function createSection(name = 'New section', columns: number[] = [1]): Section {
  return {
    id: newId('s'),
    name,
    width: 'wide',
    columns: { desktop: columns },
    style: {},
    visibility: {},
    modules: [],
  }
}

export function insertSection(doc: LayoutDocument, section: Section, at?: number): LayoutDocument {
  const next = clone(doc)
  next.sections.splice(at ?? next.sections.length, 0, section)
  return next
}

export function removeSection(doc: LayoutDocument, sectionId: string): LayoutDocument {
  const next = clone(doc)
  const found = findSection(next, sectionId)
  if (!found) return doc
  next.sections.splice(found.index, 1)
  return next
}

export function moveSection(doc: LayoutDocument, sectionId: string, toIndex: number): LayoutDocument {
  const next = clone(doc)
  const found = findSection(next, sectionId)
  if (!found) return doc
  const [section] = next.sections.splice(found.index, 1)
  next.sections.splice(Math.max(0, Math.min(toIndex, next.sections.length)), 0, section)
  return next
}

export function duplicateSection(doc: LayoutDocument, sectionId: string): LayoutDocument {
  const found = findSection(doc, sectionId)
  if (!found) return doc
  const copy = clone(found.section)
  copy.id = newId('s')
  copy.name = `${copy.name} copy`
  // Every module inside needs a fresh id too, for the same reason the module itself does.
  copy.modules = copy.modules.map((m) => ({ ...m, id: newId(), reusableId: null }))
  return insertSection(doc, copy, found.index + 1)
}

export function updateSection(doc: LayoutDocument, sectionId: string, patch: Partial<Section>): LayoutDocument {
  const next = clone(doc)
  const found = findSection(next, sectionId)
  if (!found) return doc
  Object.assign(found.section, patch)
  return next
}

/** Set the column ratios at one breakpoint; `undefined` clears an override back to inherited. */
export function setColumns(
  doc: LayoutDocument, sectionId: string, bp: Breakpoint, ratios: number[] | undefined,
): LayoutDocument {
  const next = clone(doc)
  const found = findSection(next, sectionId)
  if (!found) return doc
  if (bp === 'desktop') {
    if (!ratios?.length) return doc
    found.section.columns.desktop = ratios
  } else if (ratios?.length) {
    found.section.columns[bp] = ratios
  } else {
    delete found.section.columns[bp]
  }
  return next
}

/**
 * Keep the desktop column count in step with the module count.
 *
 * Only for EVEN grids. A section with deliberate ratios — the homepage's 58/42 — must not have a
 * third equal column appended because a module was added; that would silently destroy a proportion
 * an administrator chose. Adding a module to such a section leaves the ratios alone and the module
 * wraps, which is visible and correctable, unlike a quietly rewritten layout.
 */
function syncColumns(section: Section): void {
  const cols = section.columns.desktop
  const even = cols.every((c) => c === cols[0])
  if (!even) return
  section.columns.desktop = Array.from({ length: Math.max(1, section.modules.length) }, () => 1)
}
