'use client'

/**
 * The layer tree: every section and module on the page, nested.
 *
 * ── Why this exists alongside the canvas ─────────────────────────────────────────────────────────
 * The canvas is the honest view — it is the real page — but it cannot show you what is hidden, what
 * is nested inside what, or what is scrolled three screens away. A module hidden by a condition is
 * invisible on the canvas by design; here it is a row with a struck-through name that can still be
 * selected and un-hidden. That is the difference between "I can't find my module" and "there it is,
 * hidden on mobile".
 *
 * It is also the reliable way to reorder on a touch screen and with a keyboard: every row carries
 * explicit move buttons, so nothing here depends on dragging.
 */

import { useState } from 'react'
import * as Icons from 'lucide-react'
import { ChevronRight, Eye, EyeOff, GripVertical, Lock, Trash2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useEditor } from './editor-store'
import { getModule } from '@/lib/site-builder/registry'
import { findModule, moveModule, nudgeModule, updateModuleVisibility, walkModules } from '@/lib/site-builder/operations'
import type { ModuleInstance, Section } from '@/lib/site-builder/document'

function Icon({ name, className }: { name: string; className?: string }) {
  const map = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>
  const Cmp = map[name] ?? Icons.Box
  return <Cmp className={className} />
}

export function ModuleTree({ onRequestDelete }: { onRequestDelete: (moduleId: string) => void }) {
  const editor = useEditor()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (id: string) => setCollapsed((c) => {
    const next = new Set(c)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  if (!editor.document.sections.length) {
    return <p className="p-2 text-[11px] text-muted-foreground">This page has no sections yet. Add one from the Modules panel.</p>
  }

  return (
    <div className="flex flex-col gap-1">
      {editor.document.sections.map((section, si) => (
        <SectionRow
          key={section.id}
          section={section}
          index={si}
          total={editor.document.sections.length}
          collapsed={collapsed}
          onToggle={toggle}
          onRequestDelete={onRequestDelete}
        />
      ))}
    </div>
  )
}

function SectionRow({
  section, index, total, collapsed, onToggle, onRequestDelete,
}: {
  section: Section
  index: number
  total: number
  collapsed: Set<string>
  onToggle: (id: string) => void
  onRequestDelete: (moduleId: string) => void
}) {
  const editor = useEditor()
  const selected = editor.selection?.kind === 'section' && editor.selection.id === section.id
  const isCollapsed = collapsed.has(section.id)
  const hidden = section.visibility.hidden

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 border px-1.5 py-1',
          selected ? 'border-[var(--gold)] bg-[var(--graphite)]' : 'border-transparent hover:bg-[var(--graphite)]',
        )}
      >
        <button
          type="button"
          onClick={() => onToggle(section.id)}
          aria-label={isCollapsed ? `Expand ${section.name}` : `Collapse ${section.name}`}
          aria-expanded={!isCollapsed}
          className="text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn('size-3 transition-transform', !isCollapsed && 'rotate-90')} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => editor.select({ kind: 'section', id: section.id })}
          className={cn('flex-1 truncate text-left text-[11px] font-bold uppercase tracking-[0.1em]', hidden ? 'text-muted-foreground line-through' : 'text-foreground')}
        >
          {section.name}
        </button>
        <span className="tabular text-[10px] text-muted-foreground">{section.modules.length}</span>
        <TreeButton label={`Move ${section.name} up`} disabled={index === 0} onClick={() => editor.apply((d) => moveSectionBy(d, section.id, -1), { structural: true })}>↑</TreeButton>
        <TreeButton label={`Move ${section.name} down`} disabled={index === total - 1} onClick={() => editor.apply((d) => moveSectionBy(d, section.id, 1), { structural: true })}>↓</TreeButton>
      </div>

      {!isCollapsed && (
        <ul className="ml-3 border-l border-border pl-1">
          {section.modules.map((m) => (
            <ModuleRow
              key={m.id}
              module={m}
              depth={0}
              collapsed={collapsed}
              onToggle={onToggle}
              onRequestDelete={onRequestDelete}
            />
          ))}
          {!section.modules.length && (
            <li className="px-2 py-1 text-[10px] text-muted-foreground">Empty</li>
          )}
        </ul>
      )}
    </div>
  )
}

function ModuleRow({
  module, depth, collapsed, onToggle, onRequestDelete,
}: {
  module: ModuleInstance
  depth: number
  collapsed: Set<string>
  onToggle: (id: string) => void
  onRequestDelete: (moduleId: string) => void
}) {
  const editor = useEditor()
  const def = getModule(module.type)
  const selected = editor.selection?.kind === 'module' && editor.selection.id === module.id
  const hidden = module.visibility.hidden
  const hasChildren = !!module.children?.length
  const isCollapsed = collapsed.has(module.id)

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-1 border px-1 py-1',
          selected ? 'border-[var(--hot-red)] bg-[var(--graphite)]' : 'border-transparent hover:bg-[var(--graphite)]',
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(module.id)}
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            aria-expanded={!isCollapsed}
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn('size-3 transition-transform', !isCollapsed && 'rotate-90')} aria-hidden />
          </button>
        ) : (
          <span className="w-3" aria-hidden />
        )}

        <Icon name={def?.icon ?? 'Box'} className="size-3 shrink-0 text-muted-foreground" />

        <button
          type="button"
          onClick={() => editor.select({ kind: 'module', id: module.id })}
          className={cn('min-w-0 flex-1 truncate text-left text-[11px]', hidden ? 'text-muted-foreground line-through' : 'text-foreground')}
          title={def?.description}
        >
          {def?.name ?? module.type}
        </button>

        {/* An essential module says so in the tree, not only when you try to delete it. */}
        {def?.essential && <Lock className="size-3 shrink-0 text-[var(--gold)]" aria-label="Essential to this page" />}
        {module.reusableId && <Icons.Link2 className="size-3 shrink-0 text-[var(--brcam-teal)]" aria-label="Linked to a reusable module" />}

        <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <TreeButton label="Move up" onClick={() => editor.apply((d) => nudgeModule(d, module.id, -1), { structural: true })}>↑</TreeButton>
          <TreeButton label="Move down" onClick={() => editor.apply((d) => nudgeModule(d, module.id, 1), { structural: true })}>↓</TreeButton>
          <TreeButton
            label={hidden ? 'Show' : 'Hide'}
            onClick={() => editor.apply((d) => updateModuleVisibility(d, module.id, { hidden: !hidden }), { structural: true })}
          >
            {hidden ? <EyeOff className="size-3" aria-hidden /> : <Eye className="size-3" aria-hidden />}
          </TreeButton>
          <TreeButton label="Delete" onClick={() => onRequestDelete(module.id)}>
            <Trash2 className="size-3" aria-hidden />
          </TreeButton>
        </span>
      </div>

      {hasChildren && !isCollapsed && (
        <ul className="ml-3 border-l border-border pl-1">
          {module.children!.map((child) => (
            <ModuleRow
              key={child.id}
              module={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              onRequestDelete={onRequestDelete}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function TreeButton({ label, onClick, disabled, children }: {
  label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="px-1 text-[10px] text-muted-foreground transition hover:text-foreground disabled:opacity-25"
    >
      {children}
    </button>
  )
}

/** Move a section by one place. Kept here because only the tree offers it. */
function moveSectionBy(doc: import('@/lib/site-builder/document').LayoutDocument, sectionId: string, delta: -1 | 1) {
  const index = doc.sections.findIndex((s) => s.id === sectionId)
  if (index === -1) return doc
  const target = index + delta
  if (target < 0 || target >= doc.sections.length) return doc
  const next = structuredClone(doc)
  const [section] = next.sections.splice(index, 1)
  next.sections.splice(target, 0, section)
  return next
}

/**
 * The path from the page down to what is selected, for the toolbar.
 *
 * Ancestor names rather than ids, because "Homepage › Competition marquee › Panel" tells you where
 * you are and a chain of cuid fragments does not.
 */
export function useSelectionPath(): { id: string; label: string; kind: 'section' | 'module' }[] {
  const editor = useEditor()
  const selection = editor.selection
  if (!selection) return []

  if (selection.kind === 'section') {
    const section = editor.document.sections.find((s) => s.id === selection.id)
    return section ? [{ id: section.id, label: section.name, kind: 'section' }] : []
  }

  const found = findModule(editor.document, selection.id)
  if (!found) return []
  const path: { id: string; label: string; kind: 'section' | 'module' }[] = [
    { id: found.section.id, label: found.section.name, kind: 'section' },
  ]
  // The ancestor ids are outermost-first, which is the order a breadcrumb reads in.
  for (const ancestorId of found.ancestors) {
    const ancestor = walkModules(editor.document).find((w) => w.module.id === ancestorId)
    if (ancestor) {
      path.push({ id: ancestorId, label: getModule(ancestor.module.type)?.name ?? ancestor.module.type, kind: 'module' })
    }
  }
  path.push({ id: found.module.id, label: getModule(found.module.type)?.name ?? found.module.type, kind: 'module' })
  return path
}

export { moveModule as treeMoveModule, GripVertical as TreeGrip }
