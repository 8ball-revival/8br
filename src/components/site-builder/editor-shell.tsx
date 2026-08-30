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

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Check, ChevronsLeft, ChevronsRight, Eye, History, LayoutGrid, Loader2, Monitor,
  Redo2, Save, Send, Settings2, Smartphone, Tablet, TriangleAlert, Undo2, X,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { EditorProvider, useEditor } from './editor-store'
import { CanvasOverlay } from './canvas-overlay'
import { Inspector } from './inspector'
import { ModuleLibrary, ReplaceDialog, Dialog } from './palette'
import { BREAKPOINT_WIDTHS, type LayoutDocument } from '@/lib/site-builder/document'
import { hydrateRegistry, type ModuleManifestEntry } from '@/lib/site-builder/registry'
import { findModule } from '@/lib/site-builder/operations'
import { saveReusableAction } from '@/lib/site-builder/actions'

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
  const [publishOpen, setPublishOpen] = useState(false)

  return (
    <>
      <Toolbar pageTitle={pageTitle} onPublish={() => setPublishOpen(true)} />

      {!editor.previewing && (
        <>
          <SidePanel side="left" open={editor.panels.library} title="Modules" onToggle={() => editor.togglePanel('library')}>
            <ModuleLibrary />
          </SidePanel>
          <SidePanel side="right" open={editor.panels.inspector} title="Settings" onToggle={() => editor.togglePanel('inspector')}>
            <Inspector />
          </SidePanel>
        </>
      )}

      <CanvasOverlay
        onRequestReplace={setReplacing}
        onRequestSaveReusable={setSavingReusable}
      />

      {replacing && <ReplaceDialog moduleId={replacing} onClose={() => setReplacing(null)} />}
      {savingReusable && <SaveReusableDialog moduleId={savingReusable} onClose={() => setSavingReusable(null)} />}
      {publishOpen && <PublishDialog onClose={() => setPublishOpen(false)} />}
    </>
  )
}

// ── Toolbar ─────────────────────────────────────────────────────────────────────────────────────

function Toolbar({ pageTitle, onPublish }: { pageTitle: string; onPublish: () => void }) {
  const editor = useEditor()
  const router = useRouter()

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
      <span className="flex items-center gap-2">
        <span className="bg-[var(--hot-red)] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-white">Edit mode</span>
        <span className="truncate text-xs font-semibold text-foreground">{pageTitle}</span>
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
        <ToolButton label="Revision history" onClick={() => router.push('/admin/site-builder')}><History className="size-3.5" /></ToolButton>

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

function SidePanel({ side, open, title, onToggle, children }: {
  side: 'left' | 'right'; open: boolean; title: string; onToggle: () => void; children: React.ReactNode
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

  return (
    <Dialog title="Publish this page" onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        This makes the current draft the live version for everyone. The version that is live now is
        kept, and you can roll back to it at any time.
      </p>
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
          disabled={busy}
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
