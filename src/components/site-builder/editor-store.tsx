'use client'

/**
 * The editing session: the document being edited, what is selected, and how it gets saved.
 *
 * ── Undo is a stack of documents ─────────────────────────────────────────────────────────────────
 * Not a stack of inverse operations. Inverses have to be written per operation, and the one that is
 * wrong is always the one nobody exercised — "undo replace" restoring the wrong config, "undo move"
 * landing a module one place off. Whole documents are a few kilobytes of JSON and the operations are
 * already pure, so keeping fifty of them costs nothing measurable and cannot be subtly wrong.
 *
 * ── Autosave, and why it is debounced from the last CHANGE ───────────────────────────────────────
 * Every mutation schedules a save 1200ms later and cancels the one before it, so typing in a text
 * field produces one write when the administrator stops rather than one per keystroke. A save that
 * is in flight is never interrupted; the next one queues behind it, because two overlapping saves
 * would race on the version number and the second would be rejected as a conflict against the
 * first — a conflict with yourself, which is the most confusing possible error.
 *
 * ── Why the canvas re-renders through the server ─────────────────────────────────────────────────
 * Modules are async server components that read live competition data. The editor cannot render
 * them, and should not try — a client-side approximation would be the second rendering path this
 * whole design exists to avoid. So a structural change saves, then calls `router.refresh()`, and the
 * server re-renders the real page with the real modules. The overlay tracks it by measuring the DOM.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'

import type { Breakpoint, LayoutDocument } from '@/lib/site-builder/document'
import { saveDraftAction, publishAction } from '@/lib/site-builder/actions'

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; at: number }
  | { status: 'error'; message: string }
  | { status: 'conflict'; message: string }

export interface Selection {
  kind: 'module' | 'section'
  id: string
}

interface EditorValue {
  pageKey: string
  document: LayoutDocument
  selection: Selection | null
  select: (s: Selection | null) => void
  /** Apply a pure operation, push to the undo stack, and schedule a save. */
  apply: (fn: (doc: LayoutDocument) => LayoutDocument, options?: { immediate?: boolean }) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  dirty: boolean
  saveState: SaveState
  saveNow: () => Promise<void>
  publish: (summary?: string) => Promise<{ ok: boolean; error?: string; revision?: number }>
  breakpoint: Breakpoint
  setBreakpoint: (b: Breakpoint) => void
  previewing: boolean
  setPreviewing: (v: boolean) => void
  /** Panels an administrator can collapse to give the page the screen. */
  panels: { library: boolean; inspector: boolean }
  togglePanel: (which: 'library' | 'inspector') => void
}

const EditorContext = createContext<EditorValue | null>(null)

export function useEditor(): EditorValue {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error('useEditor must be used inside the site builder editor.')
  return ctx
}

/** Safe in read-only contexts: returns null instead of throwing when there is no editing session. */
export function useEditorOptional(): EditorValue | null {
  return useContext(EditorContext)
}

const UNDO_LIMIT = 50
const AUTOSAVE_DELAY = 1200

export function EditorProvider({
  pageKey, initialDocument, initialVersion, children,
}: {
  pageKey: string
  initialDocument: LayoutDocument
  initialVersion: number
  children: ReactNode
}) {
  const router = useRouter()
  const [document, setDocument] = useState<LayoutDocument>(initialDocument)
  const [past, setPast] = useState<LayoutDocument[]>([])
  const [future, setFuture] = useState<LayoutDocument[]>([])
  const [selection, setSelection] = useState<Selection | null>(null)
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' })
  const [dirty, setDirty] = useState(false)
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('desktop')
  const [previewing, setPreviewing] = useState(false)
  const [panels, setPanels] = useState({ library: true, inspector: true })

  /*
    Version, timer and in-flight state live in refs, not state.

    Each is read inside an async callback that must see the CURRENT value, not the one captured when
    the callback was created. As state they would be stale closures, and the symptom would be a save
    posting a version number from several edits ago and being rejected as a conflict.
  */
  const versionRef = useRef(initialVersion)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)
  /*
    Kept in step by every path that changes the document — `apply`, `undo`, `redo` — rather than by an
    assignment during render. Writing a ref while rendering is a side effect in the render phase, and
    under concurrent rendering a discarded render would leave the ref describing a document that was
    never committed. The save would then post it.
  */
  const documentRef = useRef(document)

  /*
    One save at a time, with the next queued behind it.

    Two overlapping saves would race on the version number and the second would be rejected as a
    conflict against the first — a conflict with yourself, which is the most confusing error the
    editor could produce. So a save that arrives while one is running sets a flag, and the running
    save picks it up.

    Written as a LOOP rather than by calling itself from its own `finally`. The self-reference was
    the honest expression of "and then go round again", but a function that closes over itself cannot
    be memoized, and the React compiler bailed out of the whole component rather than the one
    callback. The loop says the same thing and compiles.
  */
  const performSave = useCallback(async () => {
    if (inFlightRef.current) {
      pendingRef.current = true
      return
    }
    inFlightRef.current = true
    try {
      do {
        pendingRef.current = false
        setSaveState({ status: 'saving' })
        try {
          const result = await saveDraftAction(pageKey, documentRef.current, versionRef.current)
          if (result.ok) {
            versionRef.current = result.data.version
            setDirty(false)
            setSaveState({ status: 'saved', at: Date.now() })
          } else if (result.conflictVersion !== undefined) {
            // Deliberately NOT resolved automatically. Whichever side is discarded is somebody's
            // work, and the editor is not in a position to know which. The administrator decides.
            versionRef.current = result.conflictVersion
            setSaveState({ status: 'conflict', message: result.error })
            break
          } else {
            setSaveState({ status: 'error', message: result.error })
            break
          }
        } catch (err) {
          setSaveState({ status: 'error', message: err instanceof Error ? err.message : 'Could not save.' })
          break
        }
      } while (pendingRef.current)
    } finally {
      inFlightRef.current = false
    }
  }, [pageKey])

  const scheduleSave = useCallback((immediate = false) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (immediate) {
      void performSave()
      return
    }
    timerRef.current = setTimeout(() => { void performSave() }, AUTOSAVE_DELAY)
  }, [performSave])

  const apply = useCallback((fn: (doc: LayoutDocument) => LayoutDocument, options?: { immediate?: boolean }) => {
    setDocument((current) => {
      const next = fn(current)
      // An operation that could not do anything — a move past the end, a missing id — returns the
      // document it was given. Pushing that would put an undo step on the stack that visibly does
      // nothing, so identity is treated as "no edit happened".
      if (next === current) return current
      setPast((p) => [...p, current].slice(-UNDO_LIMIT))
      setFuture([])
      setDirty(true)
      documentRef.current = next
      scheduleSave(options?.immediate)
      return next
    })
  }, [scheduleSave])

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p
      const previous = p[p.length - 1]
      setFuture((f) => [documentRef.current, ...f].slice(0, UNDO_LIMIT))
      setDocument(previous)
      documentRef.current = previous
      setDirty(true)
      scheduleSave()
      return p.slice(0, -1)
    })
  }, [scheduleSave])

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f
      const nextDoc = f[0]
      setPast((p) => [...p, documentRef.current].slice(-UNDO_LIMIT))
      setDocument(nextDoc)
      documentRef.current = nextDoc
      setDirty(true)
      scheduleSave()
      return f.slice(1)
    })
  }, [scheduleSave])

  const saveNow = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    await performSave()
    router.refresh()
  }, [performSave, router])

  const publish = useCallback(async (summary?: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    // Always flushed first. Publishing takes what is SAVED, so publishing with an unsaved edit
    // pending would quietly ship the previous version and look like the publish had failed.
    await performSave()
    const result = await publishAction(pageKey, summary)
    if (result.ok) {
      router.refresh()
      return { ok: true, revision: result.data.revisionNumber }
    }
    return { ok: false, error: result.error }
  }, [pageKey, performSave, router])

  /*
    The browser's own "leave site?" prompt, for the case the in-app warning cannot cover.

    Only armed while there is genuinely unsaved work, because a page that always prompts on close is
    a page whose prompt gets dismissed reflexively.
  */
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const togglePanel = useCallback((which: 'library' | 'inspector') => {
    setPanels((p) => ({ ...p, [which]: !p[which] }))
  }, [])

  const value = useMemo<EditorValue>(() => ({
    pageKey,
    document,
    selection,
    select: setSelection,
    apply,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    dirty,
    saveState,
    saveNow,
    publish,
    breakpoint,
    setBreakpoint,
    previewing,
    setPreviewing,
    panels,
    togglePanel,
  }), [
    pageKey, document, selection, apply, undo, redo, past.length, future.length,
    dirty, saveState, saveNow, publish, breakpoint, previewing, panels, togglePanel,
  ])

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}
