'use client'

/**
 * The module library, and the Replace picker — one component, because they are the same question
 * asked twice: "which module goes here?"
 *
 * Replace differs only in what it offers (same-category modules) and what it does with the answer
 * (swap in place, keeping placement and compatible settings). Building it twice would have meant two
 * search boxes, two keyboard behaviours and two places for the icon lookup to go stale.
 */

import { useMemo, useState } from 'react'
import * as Icons from 'lucide-react'

import { cn } from '@/lib/utils'
import { useEditor } from './editor-store'
import { modulesByCategory, getModule, replacementsFor, sharedFields, type ModuleDefinition } from '@/lib/site-builder/registry'
import { createInstance, createSection, findModule, findSection, insertModule, insertSection, replaceModule } from '@/lib/site-builder/operations'

/**
 * Resolve a lucide icon by name.
 *
 * A module names its icon as a string so a definition stays plain data — importable by the server,
 * serialisable, and free of a component reference. An unknown name falls back rather than throwing:
 * a mistyped icon should cost an icon, not the palette.
 */
function Icon({ name, className }: { name: string; className?: string }) {
  const map = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>
  const Cmp = map[name] ?? Icons.Box
  return <Cmp className={className} />
}

export function ModuleLibrary() {
  const editor = useEditor()
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const all = modulesByCategory()
    if (!query.trim()) return all
    const q = query.toLowerCase()
    return all
      .map((g) => ({
        ...g,
        modules: g.modules.filter((m) =>
          m.name.toLowerCase().includes(q)
          || m.description.toLowerCase().includes(q)
          || m.type.toLowerCase().includes(q)),
      }))
      .filter((g) => g.modules.length > 0)
  }, [query])

  /**
   * Where a new module lands.
   *
   * After the selected module if there is one, otherwise at the end of the selected section,
   * otherwise at the end of the last section. Anything else — always appending to the document, say
   * — means an administrator who has just selected a module in the first row watches their new
   * module appear at the bottom of the page.
   */
  const add = (def: ModuleDefinition) => {
    const selection = editor.selection
    const instance = createInstance(def.type)
    editor.apply((doc) => {
      if (selection?.kind === 'module') {
        const found = findModule(doc, selection.id)
        if (found) return insertModule(doc, found.section.id, instance, found.moduleIndex + 1)
      }
      if (selection?.kind === 'section') {
        const found = findSection(doc, selection.id)
        if (found) return insertModule(doc, found.section.id, instance)
      }
      const last = doc.sections[doc.sections.length - 1]
      if (!last) {
        const section = createSection('New section')
        section.modules.push(instance)
        return insertSection(doc, section)
      }
      return insertModule(doc, last.id, instance)
    }, { structural: true })
    editor.select({ kind: 'module', id: instance.id })
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search modules…"
        aria-label="Search modules"
        className="w-full border border-border bg-transparent px-2 py-1.5 text-xs text-foreground focus:border-[var(--hot-red)] focus:outline-none"
      />

      <button
        type="button"
        onClick={() => {
          const section = createSection('New section')
          editor.apply((doc) => insertSection(doc, section), { structural: true })
          editor.select({ kind: 'section', id: section.id })
        }}
        className="flex items-center justify-center gap-1.5 border border-dashed border-border px-2 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:border-[var(--hot-red)] hover:text-foreground"
      >
        <Icons.Rows3 className="size-3.5" aria-hidden />
        Add a section
      </button>

      <div className="flex-1 overflow-y-auto">
        {groups.length === 0 && (
          <p className="p-2 text-[11px] text-muted-foreground">Nothing matches “{query}”.</p>
        )}
        {groups.map((group) => (
          <section key={group.category} className="mb-3">
            <h3 className="eyebrow sticky top-0 z-10 bg-[var(--graphite)] py-1.5 text-muted-foreground">{group.label}</h3>
            <ul className="flex flex-col gap-1">
              {group.modules.map((m) => (
                <li key={m.type}>
                  <button
                    type="button"
                    onClick={() => add(m)}
                    title={m.description}
                    className="flex w-full items-start gap-2 border border-transparent px-2 py-1.5 text-left hover:border-border hover:bg-[var(--graphite)]"
                  >
                    <Icon name={m.icon} className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-foreground">{m.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{m.description}</span>
                    </span>
                    {m.dataDriven && (
                      <span className="ml-auto shrink-0 border border-[var(--line-strong)] px-1 text-[9px] uppercase text-muted-foreground" title="Reads live registry data">
                        live
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

// ── Replace ─────────────────────────────────────────────────────────────────────────────────────

export function ReplaceDialog({ moduleId, onClose }: { moduleId: string; onClose: () => void }) {
  const editor = useEditor()
  const location = findModule(editor.document, moduleId)
  const current = location ? getModule(location.module.type) : undefined
  const options = location ? replacementsFor(location.module.type) : []
  const [chosen, setChosen] = useState<string | null>(null)

  if (!location || !current) return null

  const carried = chosen ? sharedFields(location.module.type, chosen) : []

  return (
    <Dialog title={`Replace “${current.name}”`} onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        The replacement keeps this module’s position, size, responsive settings and appearance.
        Settings that both modules share are carried across; the rest take their defaults.
      </p>

      {options.length === 0 ? (
        <p className="border border-dashed border-border p-3 text-xs text-muted-foreground">
          There is no other module in the {current.category} category to swap this for.
        </p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {options.map((m) => (
            <li key={m.type}>
              <button
                type="button"
                onClick={() => setChosen(m.type)}
                className={cn(
                  'flex w-full items-start gap-2 border px-2 py-2 text-left',
                  chosen === m.type ? 'border-[var(--hot-red)] bg-[var(--graphite)]' : 'border-border hover:bg-[var(--graphite)]',
                )}
              >
                <Icon name={m.icon} className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-xs font-semibold text-foreground">{m.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{m.description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {chosen && (
        <p className="border-l-2 border-[var(--gold)] pl-2 text-[11px] text-muted-foreground">
          {carried.length
            ? `Carried across: ${carried.join(', ')}.`
            : 'These two modules have no settings in common, so the replacement starts with its defaults.'}
          {' '}The original stays in place until you confirm, and Undo brings it back.
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="border border-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground">
          Cancel
        </button>
        <button
          type="button"
          disabled={!chosen}
          onClick={() => {
            if (!chosen) return
            editor.apply((d) => replaceModule(d, moduleId, chosen), { structural: true })
            onClose()
          }}
          className="bg-[var(--hot-red)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white disabled:opacity-40"
        >
          Replace
        </button>
      </div>
    </Dialog>
  )
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-lg flex-col gap-3 border border-[var(--line-strong)] bg-[var(--graphite)] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-black uppercase tracking-tight text-foreground">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <Icons.X className="size-4" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
