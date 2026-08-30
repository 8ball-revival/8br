'use client'

/**
 * The editing canvas: selection, hover, drag and quick actions, drawn OVER the real page.
 *
 * ── Why an overlay rather than an editable copy of the page ──────────────────────────────────────
 * The modules are async server components that read live competition data. Re-implementing them
 * client-side to make them draggable would be the second rendering path this whole design exists to
 * avoid — the editor would drift from what publishes, and the drift would be invisible until
 * somebody published. So the real page renders, and this measures it: every module frame carries a
 * `data-sb-module` attribute, and the overlay positions itself over those rectangles.
 *
 * ── The consequence, handled ─────────────────────────────────────────────────────────────────────
 * Measured positions go stale — on scroll, on resize, when an image loads, when a font swaps, when
 * the server re-renders after a save. A single measurement on mount would leave the outlines
 * drifting away from the content they describe, which looks broken and makes clicking select the
 * wrong thing. So it re-measures on a ResizeObserver, a MutationObserver, scroll and resize, and
 * again after every refresh.
 *
 * ── Why clicks are captured ──────────────────────────────────────────────────────────────────────
 * The page is made of links. Clicking a module to select it would otherwise navigate away mid-edit.
 * The overlay sits above the content and takes the click; the module underneath never receives it.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, Pencil, Plus, Replace, Save, Trash2,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { useEditor } from './editor-store'
import {
  duplicateModule, findModule, moveModule, nudgeModule, updateModuleVisibility,
} from '@/lib/site-builder/operations'

/** Never changes, so `useSyncExternalStore` never re-subscribes; the two snapshots do the work. */
const subscribeNever = () => () => {}

interface Rect { top: number; left: number; width: number; height: number }
interface Measured {
  id: string
  kind: 'module' | 'section'
  name: string
  sectionId: string
  rect: Rect
}

export function CanvasOverlay({ onRequestReplace, onRequestSaveReusable, onRequestDelete }: {
  onRequestReplace: (moduleId: string) => void
  onRequestSaveReusable: (moduleId: string) => void
  onRequestDelete: (moduleId: string) => void
}) {
  const editor = useEditor()
  const [measured, setMeasured] = useState<Measured[]>([])
  const [hovered, setHovered] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ sectionId: string; index: number } | null>(null)
  const frameRef = useRef<number | null>(null)
  /*
    The portal is mounted only AFTER hydration.

    Rendering it on the first client pass produces a tree the server did not send — the server has no
    `document.body` to portal into and returns null — and React resolves that mismatch by discarding
    the client tree, so the overlay silently never appeared. Waiting one commit makes the first
    client render match the server's, and the portal arrives in the second.

    `useSyncExternalStore` rather than `useState` + an effect: it is told the server snapshot and the
    client snapshot separately, so it reports the right answer on each side without a state update
    during commit — which the React compiler correctly flags as a cascading render.
  */
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false)

  /**
   * Measure every module and section frame.
   *
   * Positions are stored in DOCUMENT space (adding scroll), not viewport space, so the overlay does
   * not have to be re-measured on every scroll frame — it scrolls with the page because it is
   * absolutely positioned in the same coordinate system.
   */
  const measure = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      const scrollX = window.scrollX
      const scrollY = window.scrollY
      const out: Measured[] = []

      document.querySelectorAll<HTMLElement>('[data-sb-section]').forEach((el) => {
        const r = el.getBoundingClientRect()
        out.push({
          id: el.dataset.sbSection!,
          kind: 'section',
          name: el.dataset.sbSectionName ?? 'Section',
          sectionId: el.dataset.sbSection!,
          rect: { top: r.top + scrollY, left: r.left + scrollX, width: r.width, height: r.height },
        })
      })

      document.querySelectorAll<HTMLElement>('[data-sb-module]').forEach((el) => {
        const r = el.getBoundingClientRect()
        const section = el.closest<HTMLElement>('[data-sb-section]')
        out.push({
          id: el.dataset.sbModule!,
          kind: 'module',
          name: el.dataset.sbModuleName ?? el.dataset.sbModuleType ?? 'Module',
          sectionId: section?.dataset.sbSection ?? '',
          rect: { top: r.top + scrollY, left: r.left + scrollX, width: r.width, height: r.height },
        })
      })

      setMeasured(out)
    })
  }, [])

  useEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(document.body)
    // The server re-renders after every save, replacing the module subtrees wholesale. Without a
    // MutationObserver the overlay would keep describing the markup that was there before.
    const mo = new MutationObserver(measure)
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', measure)
    // Fonts and images both change layout after first paint, and both are easy to forget.
    if ('fonts' in document) void (document as Document & { fonts: FontFaceSet }).fonts.ready.then(measure)
    window.addEventListener('load', measure)
    return () => {
      ro.disconnect(); mo.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('load', measure)
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [measure, editor.document])

  const modules = useMemo(() => measured.filter((m) => m.kind === 'module'), [measured])
  const sections = useMemo(() => measured.filter((m) => m.kind === 'section'), [measured])

  // ── Keyboard ──────────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      // Never steal a key from a field. An administrator typing "Delete" into a text box must not
      // have the selected module deleted underneath them.
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return

      if (e.key === 'Escape') { editor.select(null); return }

      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) editor.redo(); else editor.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); editor.redo(); return }

      const selected = editor.selection
      if (!selected || selected.kind !== 'module') return

      // Keyboard reordering, so moving a module never REQUIRES a drag. Alt disambiguates from the
      // browser's own arrow-key scrolling.
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        editor.apply((d) => nudgeModule(d, selected.id, e.key === 'ArrowUp' ? -1 : 1), { structural: true })
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        editor.apply((d) => duplicateModule(d, selected.id), { structural: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor])

  if (editor.previewing) return null

  const selectedId = editor.selection?.id ?? null

  // ── Drag and drop ─────────────────────────────────────────────────────────────────────────────

  const handleDrop = (sectionId: string, index: number) => {
    if (!dragging) return
    editor.apply((d) => moveModule(d, dragging, sectionId, index), { structural: true })
    setDragging(null)
    setDropTarget(null)
  }

  /*
    Portalled to <body>, not rendered in place.

    The measured positions are in DOCUMENT space -- each rectangle's viewport position plus the
    scroll offset -- which only lines up if the overlay's containing block is the document origin.
    Rendered where the editor sits, the overlay was `absolute` inside <main>, which is not a
    positioned ancestor; every rectangle was offset by the header's height and the click that was
    meant to select a module landed on the page underneath it instead. A portal to <body> makes the
    coordinate space the one the measurements were taken in.
  */
  const overlay = (
    <div
      className="sb-overlay pointer-events-none absolute left-0 top-0 z-[60] w-full"
      data-sb-editing="true"
      style={{ height: typeof window !== 'undefined' ? document.documentElement.scrollHeight : '100%' }}
    >
      {/* Section outlines, drawn behind module outlines so a module always wins a click. */}
      {sections.map((s) => (
        <div
          key={`s-${s.id}`}
          className={cn(
            'absolute rounded-none border border-dashed transition-colors',
            editor.selection?.kind === 'section' && editor.selection.id === s.id
              ? 'border-[var(--gold)]'
              : 'border-transparent hover:border-[var(--line-strong)]',
          )}
          style={{ top: s.rect.top, left: s.rect.left, width: s.rect.width, height: s.rect.height }}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); editor.select({ kind: 'section', id: s.id }) }}
            className="pointer-events-auto absolute -top-[9px] left-3 bg-[var(--graphite)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
          >
            {s.name}
          </button>
        </div>
      ))}

      {modules.map((m) => {
        const isSelected = selectedId === m.id
        const isHovered = hovered === m.id
        return (
          <div
            key={m.id}
            className={cn(
              'pointer-events-auto absolute cursor-pointer border-2 transition-colors',
              isSelected ? 'border-[var(--hot-red)]' : isHovered ? 'border-[var(--acid,#19e3d0)]' : 'border-transparent',
              dragging === m.id && 'opacity-50',
            )}
            style={{ top: m.rect.top, left: m.rect.left, width: m.rect.width, height: m.rect.height }}
            onMouseEnter={() => setHovered(m.id)}
            onMouseLeave={() => setHovered((h) => (h === m.id ? null : h))}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); editor.select({ kind: 'module', id: m.id }) }}
            onDragOver={(e) => {
              if (!dragging || dragging === m.id) return
              e.preventDefault()
              // Which half of the target the pointer is in decides before or after, so a drop lands
              // where the insertion line was drawn rather than always before.
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              const after = e.clientX - rect.left > rect.width / 2
              const location = findModule(editor.document, m.id)
              if (!location) return
              setDropTarget({ sectionId: m.sectionId, index: location.moduleIndex + (after ? 1 : 0) })
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dropTarget) handleDrop(dropTarget.sectionId, dropTarget.index)
            }}
            role="button"
            tabIndex={0}
            aria-label={`${m.name}. Press Enter to select.`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                editor.select({ kind: 'module', id: m.id })
              }
            }}
          >
            {/* The name tag. Positioned outside the frame so it never covers content. */}
            {(isSelected || isHovered) && (
              <span className={cn(
                'absolute -top-[19px] left-0 whitespace-nowrap px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]',
                isSelected ? 'bg-[var(--hot-red)] text-white' : 'bg-[var(--graphite)] text-foreground',
              )}>
                {m.name}
              </span>
            )}

            {isSelected && (
              <ModuleActions
                moduleId={m.id}
                onDragStart={() => setDragging(m.id)}
                onDragEnd={() => { setDragging(null); setDropTarget(null) }}
                onReplace={() => onRequestReplace(m.id)}
                onSaveReusable={() => onRequestSaveReusable(m.id)}
                onDelete={() => onRequestDelete(m.id)}
              />
            )}
          </div>
        )
      })}

      {/* The insertion line. Drawn only while dragging, at the computed drop index. */}
      {dropTarget && <InsertionIndicator target={dropTarget} modules={modules} document={editor.document} />}

      {/* An "add here" affordance at the end of every section, so an empty section is reachable. */}
      {sections.map((s) => (
        <button
          key={`add-${s.id}`}
          type="button"
          onClick={() => { editor.select({ kind: 'section', id: s.id }); editor.togglePanel('library') }}
          className="pointer-events-auto absolute flex items-center gap-1 border border-dashed border-[var(--line-strong)] bg-[var(--graphite)]/90 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground hover:border-[var(--hot-red)] hover:text-foreground"
          style={{ top: s.rect.top + s.rect.height - 12, left: s.rect.left + s.rect.width / 2 - 60 }}
        >
          <Plus className="size-3" aria-hidden />
          Add module
        </button>
      ))}
    </div>
  )

  if (!mounted || typeof document === 'undefined') return null
  return createPortal(overlay, document.body)
}

// ── Quick actions ───────────────────────────────────────────────────────────────────────────────

function ModuleActions({
  moduleId, onDragStart, onDragEnd, onReplace, onSaveReusable, onDelete,
}: {
  moduleId: string
  onDragStart: () => void
  onDragEnd: () => void
  onReplace: () => void
  onSaveReusable: () => void
  onDelete: () => void
}) {
  const editor = useEditor()
  const location = findModule(editor.document, moduleId)
  const hidden = location?.module.visibility.hidden ?? false

  // Every action in this toolbar changes which modules exist or where they are, so each one needs
  // the server to redraw the canvas.
  const act = (fn: (d: typeof editor.document) => typeof editor.document) => (e: React.MouseEvent) => {
    e.stopPropagation()
    editor.apply(fn, { structural: true })
  }

  return (
    <div
      className="absolute -top-[19px] right-0 flex items-center gap-px bg-[var(--hot-red)]"
      onClick={(e) => e.stopPropagation()}
    >
      <span
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="cursor-grab px-1.5 py-1 text-white active:cursor-grabbing"
        title="Drag to move"
        aria-hidden
      >
        <GripVertical className="size-3.5" />
      </span>
      <ActionButton title="Move up (Alt+Up)" onClick={act((d) => nudgeModule(d, moduleId, -1))}><ArrowUp className="size-3.5" /></ActionButton>
      <ActionButton title="Move down (Alt+Down)" onClick={act((d) => nudgeModule(d, moduleId, 1))}><ArrowDown className="size-3.5" /></ActionButton>
      <ActionButton title="Edit settings" onClick={(e) => { e.stopPropagation(); if (!editor.panels.inspector) editor.togglePanel('inspector') }}><Pencil className="size-3.5" /></ActionButton>
      <ActionButton title="Replace with another module" onClick={(e) => { e.stopPropagation(); onReplace() }}><Replace className="size-3.5" /></ActionButton>
      <ActionButton title="Duplicate (Ctrl+D)" onClick={act((d) => duplicateModule(d, moduleId))}><Copy className="size-3.5" /></ActionButton>
      <ActionButton
        title={hidden ? 'Show again' : 'Hide temporarily'}
        onClick={act((d) => updateModuleVisibility(d, moduleId, { hidden: !hidden }))}
      >
        {hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </ActionButton>
      <ActionButton title="Save as reusable" onClick={(e) => { e.stopPropagation(); onSaveReusable() }}><Save className="size-3.5" /></ActionButton>
      <ActionButton title="Move to trash" onClick={(e) => { e.stopPropagation(); onDelete() }}><Trash2 className="size-3.5" /></ActionButton>
    </div>
  )
}

function ActionButton({ title, onClick, children }: {
  title: string
  onClick: (e: React.MouseEvent) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="px-1.5 py-1 text-white transition hover:bg-black/25"
    >
      {children}
    </button>
  )
}

function InsertionIndicator({ target, modules, document: doc }: {
  target: { sectionId: string; index: number }
  modules: Measured[]
  document: import('@/lib/site-builder/document').LayoutDocument
}) {
  const section = doc.sections.find((s) => s.id === target.sectionId)
  if (!section) return null
  const before = section.modules[target.index]
  const after = section.modules[target.index - 1]
  const anchor = modules.find((m) => m.id === (before?.id ?? after?.id))
  if (!anchor) return null
  const atEnd = !before
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-[61] w-1 bg-[var(--gold)]"
      style={{
        top: anchor.rect.top,
        left: atEnd ? anchor.rect.left + anchor.rect.width - 2 : anchor.rect.left - 2,
        height: anchor.rect.height,
      }}
    />
  )
}
