'use client'

/**
 * The editor chrome: the toolbar, the two side panels and the dialogs.
 *
 * ── Why the panels are fixed overlays rather than a three-column layout ──────────────────────────
 * The canvas IS the real page. Putting it in a middle column would change its width, and every
 * responsive decision on the page — where the marquee stacks, when the rankings table switches to
 * cards — would then be answering a width the visitor will never see. An administrator would be
 * editing a layout that does not exist. The panels float above instead, and both collapse, so the
 * page is always being edited at its true width.
 *
 * ── Mobile ───────────────────────────────────────────────────────────────────────────────────────
 * Below the large breakpoint the panels become bottom sheets and the module actions stay as explicit
 * buttons — Move Up, Move Down, Duplicate, Replace. Nothing in the editor REQUIRES a precise drag,
 * on any device: dragging is an accelerator for people who have a mouse, never the only way to do
 * something.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Check, ChevronRight, ChevronsLeft, ChevronsRight, Command, Eye, History, LayoutGrid, Layers,
  Loader2, Monitor, Redo2, Save, Send, Settings2, Smartphone, Tablet, TriangleAlert, Undo2, X,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { EditorProvider, useEditor } from './editor-store'
import { CanvasOverlay } from './canvas-overlay'
import { Inspector } from './inspector'
import { ModuleLibrary, ReplaceDialog, Dialog } from './palette'
import { BREAKPOINT_WIDTHS, type LayoutDocument } from '@/lib/site-builder/document'
import { hydrateRegistry, type ModuleManifestEntry } from '@/lib/site-builder/registry'
import { duplicateModule, findModule, removeModule } from '@/lib/site-builder/operations'
import { saveReusableAction, saveTemplateAction, trashAction } from '@/lib/site-builder/actions'
import { getModule } from '@/lib/site-builder/registry'
import { validateDocument } from '@/lib/site-builder/document'
import { ModuleTree, useSelectionPath } from './module-tree'
import { CommandPalette, type PaletteAction } from './command-palette'

export function SiteBuilderEditor({ pageKey, document, version, pageTitle, manifest }: {
  pageKey: string
  document: LayoutDocument
  version: number
  pageTitle: string
  manifest: ModuleManifestEntry[]
}) {
  /*
    Hydrated during render, not in an effect.

    The inspector and the palette read the registry on their FIRST render. Populating it from an
    effect would mean that first pass sees an empty registry and reports every module as unknown --
    which is exactly the bug this manifest exists to fix, moved one frame later. Registration is
    idempotent, so doing it on every render is harmless.
  */
  hydrateRegistry(manifest)

  return (
    <EditorProvider pageKey={pageKey} initialDocument={document} initialVersion={version}>
      <Shell pageTitle={pageTitle} />
    </EditorProvider>
  )
}

function Shell({ pageTitle }: { pageTitle: string }) {
  const editor = useEditor()
  const [replacing, setReplacing] = useState<string | null>(null)
  const [savingReusable, setSavingReusable] = useState<string | null>(null)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [tab, setTab] = useState<'library' | 'tree'>('library')

  // ── Ctrl+K, and the clipboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      if (typing) return

      const selected = editor.selection
      if (mod && e.key.toLowerCase() === 'c' && selected?.kind === 'module') {
        const found = findModule(editor.document, selected.id)
        if (found) {
          /*
            The clipboard carries the module as JSON, so a copy survives a reload and can cross to
            another page or another tab. It is read back through the same validator every other
            input goes through, so nothing pasted can bypass the registry.
          */
          void navigator.clipboard?.writeText(JSON.stringify({ __sbModule: found.module }, null, 2))
        }
        return
      }
      if (mod && e.key.toLowerCase() === 'v') {
        void navigator.clipboard?.readText().then((text) => {
          try {
            const parsed = JSON.parse(text)
            if (!parsed?.__sbModule) return
            const check = validateDocument({
              version: 1,
              sections: [{ id: 'paste', name: 'paste', width: 'wide', columns: { desktop: [1] }, style: {}, visibility: {}, modules: [parsed.__sbModule] }],
            })
            const pasted = check.value.sections[0]?.modules[0]
            if (!pasted) return
            editor.apply((d) => {
              const target = selected?.kind === 'module' ? findModule(d, selected.id) : null
              const sectionId = target?.section.id ?? d.sections[d.sections.length - 1]?.id
              if (!sectionId) return d
              return insertPasted(d, sectionId, pasted, target?.moduleIndex)
            }, { structural: true })
          } catch {
            // Not our clipboard content. Pasting something else must do nothing at all.
          }
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor])

  const paletteActions = useCommands({
    onPublish: () => { setPaletteOpen(false); setPublishOpen(true) },
    onSaveTemplate: () => { setPaletteOpen(false); setSavingTemplate(true) },
    onReplace: (id) => { setPaletteOpen(false); setReplacing(id) },
    onDelete: (id) => { setPaletteOpen(false); setDeleting(id) },
    onTree: () => { setPaletteOpen(false); setTab('tree'); if (!editor.panels.library) editor.togglePanel('library') },
    onClose: () => setPaletteOpen(false),
  })

  return (
    <>
      <Toolbar
        pageTitle={pageTitle}
        onPublish={() => setPublishOpen(true)}
        onPalette={() => setPaletteOpen(true)}
      />

      {!editor.previewing && (
        <>
          <SidePanel
            side="left"
            open={editor.panels.library}
            title={tab === 'library' ? 'Modules' : 'Layers'}
            onToggle={() => editor.togglePanel('library')}
            tabs={
              <div className="flex border border-border" role="tablist" aria-label="Left panel">
                {(['library', 'tree'] as const).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={cn(
                      'flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] transition',
                      tab === t ? 'bg-[var(--hot-red)] text-white' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t === 'library' ? 'Add' : 'Layers'}
                  </button>
                ))}
              </div>
            }
          >
            {tab === 'library' ? <ModuleLibrary /> : <ModuleTree onRequestDelete={setDeleting} />}
          </SidePanel>
          <SidePanel side="right" open={editor.panels.inspector} title="Settings" onToggle={() => editor.togglePanel('inspector')}>
            <Inspector />
          </SidePanel>
        </>
      )}

      <CanvasOverlay
        onRequestReplace={setReplacing}
        onRequestSaveReusable={setSavingReusable}
        onRequestDelete={setDeleting}
      />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
      {replacing && <ReplaceDialog moduleId={replacing} onClose={() => setReplacing(null)} />}
      {savingReusable && <SaveReusableDialog moduleId={savingReusable} onClose={() => setSavingReusable(null)} />}
      {savingTemplate && <SaveTemplateDialog onClose={() => setSavingTemplate(false)} />}
      {deleting && <DeleteDialog moduleId={deleting} onClose={() => setDeleting(null)} />}
      {publishOpen && <PublishDialog onClose={() => setPublishOpen(false)} />}
    </>
  )
}

/** Insert a pasted module after the target, or at the end of the section. */
function insertPasted(
  doc: LayoutDocument,
  sectionId: string,
  instance: import('@/lib/site-builder/document').ModuleInstance,
  afterIndex?: number,
): LayoutDocument {
  const next = structuredClone(doc)
  const section = next.sections.find((sec) => sec.id === sectionId)
  if (!section) return doc
  section.modules.splice(afterIndex === undefined ? section.modules.length : afterIndex + 1, 0, instance)
  return next
}

/** The commands the palette offers, beyond the module catalogue. */
function useCommands({
  onPublish, onSaveTemplate, onReplace, onDelete, onTree, onClose,
}: {
  onPublish: () => void
  onSaveTemplate: () => void
  onReplace: (id: string) => void
  onDelete: (id: string) => void
  onTree: () => void
  onClose: () => void
}): PaletteAction[] {
  const editor = useEditor()
  const router = useRouter()
  const selected = editor.selection?.kind === 'module' ? editor.selection.id : null

  return useCallback((): PaletteAction[] => {
    const list: PaletteAction[] = [
      { id: 'save', label: 'Save draft', icon: 'Save', run: () => { onClose(); void editor.saveNow() } },
      { id: 'publish', label: 'Publish this page', hint: 'Makes the draft live for everyone', icon: 'Send', run: onPublish },
      { id: 'undo', label: 'Undo', icon: 'Undo2', run: () => { onClose(); editor.undo() } },
      { id: 'redo', label: 'Redo', icon: 'Redo2', run: () => { onClose(); editor.redo() } },
      { id: 'preview', label: editor.previewing ? 'Leave preview' : 'Preview', icon: 'Eye', run: () => { onClose(); editor.setPreviewing(!editor.previewing) } },
      { id: 'desktop', label: 'Preview desktop', icon: 'Monitor', run: () => { onClose(); editor.setBreakpoint('desktop') } },
      { id: 'tablet', label: 'Preview tablet', icon: 'Tablet', run: () => { onClose(); editor.setBreakpoint('tablet') } },
      { id: 'mobile', label: 'Preview mobile', icon: 'Smartphone', run: () => { onClose(); editor.setBreakpoint('mobile') } },
      { id: 'layers', label: 'Open the layer tree', icon: 'Layers', run: onTree },
      { id: 'template', label: 'Save this page as a template', icon: 'FileStack', run: onSaveTemplate },
      { id: 'history', label: 'Revision history', hint: 'Opens the control centre', icon: 'History', run: () => { onClose(); router.push('/staff/site-builder') } },
      { id: 'centre', label: 'Open the Site Builder control centre', icon: 'LayoutDashboard', run: () => { onClose(); router.push('/staff/site-builder') } },
    ]
    if (selected) {
      list.push(
        { id: 'replace', label: 'Replace the selected module', icon: 'Replace', run: () => onReplace(selected) },
        { id: 'duplicate', label: 'Duplicate the selected module', icon: 'Copy', run: () => { onClose(); editor.apply((d) => duplicateModule(d, selected), { structural: true }) } },
        { id: 'delete', label: 'Delete the selected module', icon: 'Trash2', run: () => onDelete(selected) },
      )
    }
    return list
  }, [editor, router, selected, onPublish, onSaveTemplate, onReplace, onDelete, onTree, onClose])()
}

// ── Toolbar ─────────────────────────────────────────────────────────────────────────────────────

function Toolbar({ pageTitle, onPublish, onPalette }: {
  pageTitle: string; onPublish: () => void; onPalette: () => void
}) {
  const editor = useEditor()
  const router = useRouter()
  const path = useSelectionPath()

  const exit = () => {
    if (editor.dirty && !window.confirm('You have changes that have not been saved yet. Leave Edit Mode anyway?')) return
    // The flag lives in the URL, not in storage: it survives a refresh, it can be linked, and it
    // cannot get stuck on — closing the tab genuinely leaves Edit Mode.
    const url = new URL(window.location.href)
    url.searchParams.delete('edit')
    router.push(url.pathname + url.search)
    router.refresh()
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[70] flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--line-strong)] bg-[var(--graphite)] px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <span className="bg-[var(--hot-red)] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-white">Edit mode</span>
        {/* The breadcrumb: where you are, not merely what page you are on. */}
        <nav aria-label="Selection" className="flex min-w-0 items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => editor.select(null)}
            className="shrink-0 font-semibold text-foreground hover:underline"
          >
            {pageTitle}
          </button>
          {path.map((crumb) => (
            <span key={crumb.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <button
                type="button"
                onClick={() => editor.select({ kind: crumb.kind, id: crumb.id })}
                className="truncate text-muted-foreground hover:text-foreground"
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
      </span>

      <SaveIndicator />

      <div className="ml-auto flex flex-wrap items-center gap-1">
        <ToolButton label="Undo" shortcut="Ctrl+Z" onClick={editor.undo} disabled={!editor.canUndo}><Undo2 className="size-3.5" /></ToolButton>
        <ToolButton label="Redo" shortcut="Ctrl+Shift+Z" onClick={editor.redo} disabled={!editor.canRedo}><Redo2 className="size-3.5" /></ToolButton>

        <span className="mx-1 h-4 w-px bg-[var(--line-strong)]" aria-hidden />

        <DeviceButton bp="desktop" icon={<Monitor className="size-3.5" />} />
        <DeviceButton bp="tablet" icon={<Tablet className="size-3.5" />} />
        <DeviceButton bp="mobile" icon={<Smartphone className="size-3.5" />} />

        <span className="mx-1 h-4 w-px bg-[var(--line-strong)]" aria-hidden />

        <ToolButton
          label={editor.previewing ? 'Leave preview' : 'Preview'}
          onClick={() => editor.setPreviewing(!editor.previewing)}
          active={editor.previewing}
        >
          <Eye className="size-3.5" />
        </ToolButton>
        <ToolButton label="Modules" onClick={() => editor.togglePanel('library')} active={editor.panels.library}><LayoutGrid className="size-3.5" /></ToolButton>
        <ToolButton label="Settings" onClick={() => editor.togglePanel('inspector')} active={editor.panels.inspector}><Settings2 className="size-3.5" /></ToolButton>
        <ToolButton label="Layers" onClick={() => editor.togglePanel('library')}><Layers className="size-3.5" /></ToolButton>
        <ToolButton label="Commands" shortcut="Ctrl+K" onClick={onPalette}><Command className="size-3.5" /></ToolButton>
        <ToolButton label="Revision history" onClick={() => router.push('/staff/site-builder')}><History className="size-3.5" /></ToolButton>

        <span className="mx-1 h-4 w-px bg-[var(--line-strong)]" aria-hidden />

        <button
          type="button"
          onClick={() => void editor.saveNow()}
          className="flex items-center gap-1.5 border border-border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-foreground hover:border-[var(--hot-red)]"
        >
          <Save className="size-3.5" aria-hidden /> Save draft
        </button>
        <button
          type="button"
          onClick={onPublish}
          className="flex items-center gap-1.5 bg-[var(--hot-red)] px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white hover:brightness-110"
        >
          <Send className="size-3.5" aria-hidden /> Publish
        </button>
        <ToolButton label="Exit Edit Mode" onClick={exit}><X className="size-3.5" /></ToolButton>
      </div>
    </div>
  )
}

function SaveIndicator() {
  const editor = useEditor()
  const s = editor.saveState
  const base = 'flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em]'
  if (s.status === 'saving') return <span className={cn(base, 'text-muted-foreground')}><Loader2 className="size-3 animate-spin" aria-hidden /> Saving</span>
  if (s.status === 'saved') return <span className={cn(base, 'text-muted-foreground')}><Check className="size-3" aria-hidden /> Saved</span>
  if (s.status === 'conflict') {
    return (
      <span className={cn(base, 'text-[var(--gold)]')} title={s.message}>
        <TriangleAlert className="size-3" aria-hidden /> Changed elsewhere
      </span>
    )
  }
  if (s.status === 'error') return <span className={cn(base, 'text-[var(--hot-red)]')} title={s.message}><TriangleAlert className="size-3" aria-hidden /> Not saved</span>
  return <span className={cn(base, 'text-muted-foreground')}>{editor.dirty ? 'Unsaved changes' : 'Up to date'}</span>
}

function ToolButton({ label, shortcut, onClick, disabled, active, children }: {
  label: string; shortcut?: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'border p-1.5 transition disabled:opacity-30',
        active ? 'border-[var(--hot-red)] text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

/**
 * The device buttons.
 *
 * They set the breakpoint the INSPECTOR is editing, and they narrow the page so the administrator
 * can see that width. They do not emulate a device — no touch, no user agent — because pretending
 * to would invite trusting the preview for things it cannot answer.
 */
function DeviceButton({ bp, icon }: { bp: 'desktop' | 'tablet' | 'mobile'; icon: React.ReactNode }) {
  const editor = useEditor()
  const active = editor.breakpoint === bp
  return (
    <button
      type="button"
      onClick={() => {
        editor.setBreakpoint(bp)
        const el = window.document.querySelector<HTMLElement>('main')
        if (el) {
          el.style.maxWidth = bp === 'desktop' ? '' : `${BREAKPOINT_WIDTHS[bp]}px`
          el.style.marginInline = bp === 'desktop' ? '' : 'auto'
          el.style.outline = bp === 'desktop' ? '' : '1px dashed var(--line-strong)'
        }
      }}
      title={`${bp} — edit and preview at this width`}
      aria-label={`${bp} layout`}
      aria-pressed={active}
      className={cn('border p-1.5 transition', active ? 'border-[var(--hot-red)] text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
    >
      {icon}
    </button>
  )
}

// ── Panels ──────────────────────────────────────────────────────────────────────────────────────

function SidePanel({ side, open, title, onToggle, children, tabs }: {
  side: 'left' | 'right'
  open: boolean
  title: string
  onToggle: () => void
  children: React.ReactNode
  tabs?: React.ReactNode
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label={`Open the ${title.toLowerCase()} panel`}
        className={cn(
          'fixed top-1/2 z-[65] -translate-y-1/2 border border-[var(--line-strong)] bg-[var(--graphite)] p-1.5 text-muted-foreground hover:text-foreground',
          side === 'left' ? 'left-0' : 'right-0',
        )}
      >
        {side === 'left' ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
      </button>
    )
  }
  return (
    <aside
      aria-label={title}
      className={cn(
        'fixed z-[65] flex flex-col gap-2 border-[var(--line-strong)] bg-[var(--graphite)]/97 p-2.5 backdrop-blur',
        // Desktop: a fixed rail. Below that: a bottom sheet, which is reachable one-handed and does
        // not steal the width the page is being edited at.
        'max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[55vh] max-lg:border-t',
        'lg:top-[45px] lg:h-[calc(100vh-45px)] lg:w-[280px] lg:overflow-y-auto',
        side === 'left' ? 'lg:left-0 lg:border-r' : 'lg:right-0 lg:border-l',
      )}
    >
      <div className="flex items-center justify-between">
        <h2 className="eyebrow text-foreground">{title}</h2>
        <button type="button" onClick={onToggle} aria-label={`Close the ${title.toLowerCase()} panel`} className="text-muted-foreground hover:text-foreground">
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      {tabs}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  )
}

// ── Dialogs ─────────────────────────────────────────────────────────────────────────────────────

function PublishDialog({ onClose }: { onClose: () => void }) {
  const editor = useEditor()
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const moduleCount = editor.document.sections.reduce((n, s) => n + s.modules.length, 0)

  /*
    Validated before the button is offered, not after it is pressed.

    A publish that fails on the server tells you only that something is wrong. Checking here lets
    the dialog name the module, say what is wrong with it, and take you straight to it — which is the
    difference between a two-second fix and hunting through a page.
  */
  const check = validateDocument(editor.document)
  const problems = check.issues.map((issue) => {
    // "sections.0.modules.2.config.href" -> the module that owns it.
    const match = /^sections\.(\d+)\.modules\.(\d+)/.exec(issue.path)
    const section = match ? editor.document.sections[Number(match[1])] : undefined
    const instance = section?.modules[Number(match?.[2] ?? -1)]
    return {
      issue,
      moduleId: instance?.id,
      moduleName: instance ? (getModule(instance.type)?.name ?? instance.type) : 'This page',
      field: issue.path.split('.').pop() ?? '',
    }
  })

  // An essential module that has been hidden is not invalid — it is a decision — but it is worth
  // saying out loud at the moment it becomes public.
  const hiddenEssentials = editor.document.sections.flatMap((sec) => sec.modules
    .filter((m) => m.visibility.hidden && getModule(m.type)?.essential)
    .map((m) => getModule(m.type)!))

  return (
    <Dialog title="Publish this page" onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        This makes the current draft the live version for everyone. The version that is live now is
        kept, and you can roll back to it at any time.
      </p>

      {problems.length > 0 && (
        <div className="border border-[var(--hot-red)] p-2.5">
          <p className="eyebrow text-[var(--hot-red)]">
            {problems.length} setting{problems.length === 1 ? '' : 's'} need attention before this can publish
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {problems.slice(0, 6).map((p, i) => (
              <li key={i} className="text-[11px] text-muted-foreground">
                <button
                  type="button"
                  onClick={() => {
                    if (p.moduleId) editor.select({ kind: 'module', id: p.moduleId })
                    onClose()
                  }}
                  className="font-semibold text-foreground underline underline-offset-2"
                >
                  {p.moduleName}
                </button>
                {' — '}{p.field}: {p.issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hiddenEssentials.length > 0 && (
        <p className="border-l-2 border-[var(--gold)] pl-2 text-[11px] text-[var(--gold)]">
          {hiddenEssentials.map((d) => d.name).join(', ')} {hiddenEssentials.length === 1 ? 'is' : 'are'} hidden.
          {' '}{hiddenEssentials[0].essential}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-px border border-border bg-border text-center">
        <div className="bg-[var(--graphite)] px-2 py-2">
          <dt className="eyebrow text-muted-foreground">Sections</dt>
          <dd className="tabular font-display text-lg font-black text-foreground">{editor.document.sections.length}</dd>
        </div>
        <div className="bg-[var(--graphite)] px-2 py-2">
          <dt className="eyebrow text-muted-foreground">Modules</dt>
          <dd className="tabular font-display text-lg font-black text-foreground">{moduleCount}</dd>
        </div>
      </dl>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">What changed (optional)</span>
        <input
          type="text"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Replaced the WCC panel with the registration announcement"
          className="w-full border border-border bg-transparent px-2 py-1.5 text-xs text-foreground focus:border-[var(--hot-red)] focus:outline-none"
        />
      </label>
      {error && <p className="border-l-2 border-[var(--hot-red)] pl-2 text-[11px] text-[var(--hot-red)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="border border-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || problems.length > 0}
          title={problems.length ? 'Fix the settings above first' : undefined}
          onClick={async () => {
            setBusy(true); setError(null)
            const result = await editor.publish(summary || undefined)
            setBusy(false)
            if (result.ok) onClose()
            else setError(result.error ?? 'Could not publish.')
          }}
          className="flex items-center gap-1.5 bg-[var(--hot-red)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="size-3 animate-spin" aria-hidden />}
          Publish now
        </button>
      </div>
    </Dialog>
  )
}

function SaveReusableDialog({ moduleId, onClose }: { moduleId: string; onClose: () => void }) {
  const editor = useEditor()
  const location = findModule(editor.document, moduleId)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!location) return null

  return (
    <Dialog title="Save as a reusable module" onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        Saves these settings so the same module can be dropped onto other pages.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Season 2 registration announcement"
          className="w-full border border-border bg-transparent px-2 py-1.5 text-xs text-foreground focus:border-[var(--hot-red)] focus:outline-none"
        />
      </label>
      {error && <p className="border-l-2 border-[var(--hot-red)] pl-2 text-[11px] text-[var(--hot-red)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="border border-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground">Cancel</button>
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true); setError(null)
            const result = await saveReusableAction(name, location.module.type, location.module.config, 'saved')
            setBusy(false)
            if (result.ok) onClose(); else setError(result.error)
          }}
          className="bg-[var(--hot-red)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </Dialog>
  )
}

/**
 * Deleting a module, with a guard proportional to what is being deleted.
 *
 * An ordinary module needs one confirmation. An ESSENTIAL one — the rankings table on /rankings, the
 * bracket on a Season — needs the module's name typed out, because deleting one publishes a page
 * that no longer does its job and "are you sure?" is a question people answer without reading.
 *
 * The trash write happens BEFORE the removal. The other order loses the module entirely if the trash
 * write fails, and the trash is what makes deletion recoverable after the session ends — which is
 * exactly when somebody needs it.
 */
function DeleteDialog({ moduleId, onClose }: { moduleId: string; onClose: () => void }) {
  const editor = useEditor()
  const location = findModule(editor.document, moduleId)
  const def = location ? getModule(location.module.type) : undefined
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!location || !def) return null

  const essential = def.essential
  const confirmWord = def.name
  const ready = !essential || typed.trim().toLowerCase() === confirmWord.toLowerCase()

  const run = async () => {
    setBusy(true)
    setError(null)
    const result = await trashAction('module', def.name, location.module)
    if (!result.ok) {
      setBusy(false)
      setError(`Not deleted: it could not be copied to the trash first. ${result.error}`)
      return
    }
    editor.apply((d) => removeModule(d, moduleId), { structural: true })
    editor.select(null)
    onClose()
  }

  return (
    <Dialog title={essential ? `Remove ${def.name}?` : `Delete ${def.name}?`} onClose={onClose}>
      {essential ? (
        <>
          <p className="border-l-2 border-[var(--hot-red)] pl-3 text-sm text-foreground">{essential}</p>
          <p className="text-xs text-muted-foreground">
            You can still do this — the page will publish and the rest of it will work. But visitors
            will no longer find what this page is for, so type <strong className="text-foreground">{confirmWord}</strong> to confirm you mean it.
          </p>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={confirmWord}
            aria-label={`Type ${confirmWord} to confirm`}
            className="w-full border border-border bg-transparent px-2 py-1.5 text-xs text-foreground focus:border-[var(--hot-red)] focus:outline-none"
          />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          It goes to the trash and stays there for 30 days, so this is recoverable. Undo brings it
          straight back.
        </p>
      )}
      {error && <p className="border-l-2 border-[var(--hot-red)] pl-2 text-[11px] text-[var(--hot-red)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="border border-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground">
          Keep it
        </button>
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => void run()}
          className="flex items-center gap-1.5 bg-[var(--hot-red)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white disabled:opacity-40"
        >
          {busy && <Loader2 className="size-3 animate-spin" aria-hidden />}
          Move to trash
        </button>
      </div>
    </Dialog>
  )
}

/** Save the whole page layout as a template to start other pages from. */
function SaveTemplateDialog({ onClose }: { onClose: () => void }) {
  const editor = useEditor()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Dialog title="Save this page as a template" onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        Keeps this page&rsquo;s structure — its sections, modules and settings — so another page can
        start from it. It does not link the two: a template is a starting point, not a live copy.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Competition landing page"
          className="w-full border border-border bg-transparent px-2 py-1.5 text-xs text-foreground focus:border-[var(--hot-red)] focus:outline-none"
        />
      </label>
      {error && <p className="border-l-2 border-[var(--hot-red)] pl-2 text-[11px] text-[var(--hot-red)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="border border-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground">Cancel</button>
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true); setError(null)
            const result = await saveTemplateAction(name, 'page', editor.document)
            setBusy(false)
            if (result.ok) onClose(); else setError(result.error)
          }}
          className="bg-[var(--hot-red)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white disabled:opacity-40"
        >
          Save template
        </button>
      </div>
    </Dialog>
  )
}
