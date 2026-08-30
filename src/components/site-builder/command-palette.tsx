'use client'

/**
 * The command palette: everything the editor can do, from the keyboard.
 *
 * ── Why it lists modules as well as commands ─────────────────────────────────────────────────────
 * With sixty-odd modules, "add a countdown" is faster to type than to find by scrolling a category
 * open. So the palette searches commands AND the module catalogue in one list, and inserting is the
 * same gesture as publishing. It is the only place in the editor where the two are equivalent, which
 * is the point of a palette.
 *
 * Ctrl+K, or Cmd+K. Escape closes. Arrow keys move, Enter runs.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import * as Icons from 'lucide-react'

import { cn } from '@/lib/utils'
import { useEditor } from './editor-store'
import { allModules, getModule } from '@/lib/site-builder/registry'
import {
  createInstance, createSection, findModule, findSection, insertModule, insertSection,
} from '@/lib/site-builder/operations'

export interface PaletteAction {
  id: string
  label: string
  hint?: string
  icon: string
  run: () => void
}

function Icon({ name, className }: { name: string; className?: string }) {
  const map = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>
  const Cmp = map[name] ?? Icons.Command
  return <Cmp className={className} />
}

/**
 * Only mounted while open.
 *
 * The obvious shape is one component that returns null when closed and resets its query in an
 * effect — but resetting state from an effect is a cascading render, and it also means the palette
 * briefly shows the previous search on reopening. Mounting fresh gives the reset for nothing.
 */
export function CommandPalette(props: { open: boolean; onClose: () => void; actions: PaletteAction[] }) {
  if (!props.open) return null
  return <PaletteBody onClose={props.onClose} actions={props.actions} />
}

function PaletteBody({ onClose, actions }: { onClose: () => void; actions: PaletteAction[] }) {
  const editor = useEditor()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus, once, after the input exists. Not a state update, so it is a legitimate effect.
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  /*
    Escape closes it from anywhere, not only from the search box.

    It was on the input's own `onKeyDown`, which works right up until focus is somewhere else — a
    click on a result row, a browser that did not honour the autofocus, a screen reader moving the
    cursor. A modal you cannot dismiss with Escape is the kind of thing that gets discovered by
    somebody stuck in it, so the listener is on the window for as long as the palette is mounted.
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  /** Inserting from the palette lands where the palette was opened, like the Modules panel. */
  const insert = (type: string) => {
    const selection = editor.selection
    const instance = createInstance(type)
    editor.apply((doc) => {
      if (selection?.kind === 'module') {
        const found = findModule(doc, selection.id)
        if (found) {
          const def = getModule(found.module.type)
          // Into a selected container, rather than after it: choosing a container and then adding
          // almost always means "put it in here".
          if (def?.container) return insertModule(doc, found.section.id, instance, undefined, found.module.id)
          return insertModule(doc, found.section.id, instance, found.moduleIndex + 1, found.parent?.id)
        }
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
    onClose()
  }

  const moduleActions = useMemo<PaletteAction[]>(() => allModules().map((m) => ({
    id: `add:${m.type}`,
    label: `Add ${m.name}`,
    hint: m.description,
    icon: m.icon,
    run: () => insert(m.type),
  // `insert` closes over the current selection, which is exactly what we want each time the palette
  // opens; recreating the list per render is cheap next to a keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [editor.selection, editor.document])

  const all = useMemo(() => [...actions, ...moduleActions], [actions, moduleActions])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all.slice(0, 12)
    /*
      Ranked, not merely filtered.

      A label that STARTS with what was typed is almost always the intended one, so "pub" must offer
      Publish before "Republish a revision". Plain substring order would bury it.
    */
    const scored = all
      .map((a) => {
        const label = a.label.toLowerCase()
        const hint = (a.hint ?? '').toLowerCase()
        if (label.startsWith(q)) return { a, score: 0 }
        if (label.includes(q)) return { a, score: 1 }
        if (hint.includes(q)) return { a, score: 2 }
        return null
      })
      .filter((x): x is { a: PaletteAction; score: number } => x !== null)
      .sort((x, y) => x.score - y.score || x.a.label.localeCompare(y.a.label))
    return scored.slice(0, 20).map((x) => x.a)
  }, [all, query])

  /*
    The highlighted row is clamped during render rather than reset from an effect.

    Typing shortens the list, and an index left pointing past the end would make Enter do nothing.
    Clamping here means the row under the cursor is always a row that exists, on the same render the
    list changed — an effect would leave one frame where it did not.
  */
  const activeIndex = Math.min(active, Math.max(0, results.length - 1))

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/60 p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-xl flex-col border border-[var(--line-strong)] bg-[var(--graphite)]"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a command, or a module to add…"
          aria-label="Command"
          aria-controls="sb-palette-results"
          aria-activedescendant={results[activeIndex] ? `sb-palette-${results[activeIndex].id}` : undefined}
          className="border-b border-border bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return }
            if (e.key === 'Enter') {
              e.preventDefault()
              results[activeIndex]?.run()
            }
          }}
        />
        <ul id="sb-palette-results" role="listbox" className="max-h-[50vh] overflow-y-auto">
          {!results.length && (
            <li className="px-4 py-3 text-xs text-muted-foreground">Nothing matches “{query}”.</li>
          )}
          {results.map((r, i) => (
            <li key={r.id} id={`sb-palette-${r.id}`} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => r.run()}
                className={cn(
                  'flex w-full items-start gap-2.5 px-4 py-2 text-left',
                  i === activeIndex ? 'bg-[var(--hot-red)]/15' : 'hover:bg-black/20',
                )}
              >
                <Icon name={r.icon} className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-foreground">{r.label}</span>
                  {r.hint && <span className="block truncate text-[11px] text-muted-foreground">{r.hint}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-4 py-1.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          ↑↓ to move · Enter to run · Esc to close
        </p>
      </div>
    </div>
  )
}
