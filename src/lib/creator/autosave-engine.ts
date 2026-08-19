/**
 * The autosave state machine, with no React and no network in it.
 *
 * Autosave looks trivial and is not: the failure modes are a save that fires on every keystroke, two
 * saves racing so the older one lands last, a "Saved" badge that lies because the response it came
 * from is stale, and a navigation guard that blocks on changes already written. All four are timing
 * bugs, and timing bugs are exactly what a component test cannot pin down.
 *
 * So the rules live here as a plain object driven by explicit `change`, `tick` and `settle` calls.
 * A test can drive a hundred interleavings deterministically; the React hook wrapping it supplies
 * only a timer and a transport.
 *
 * ── The rules ────────────────────────────────────────────────────────────────────────────────────
 *   • A change marks the form dirty and starts (or restarts) the debounce.
 *   • Only ONE save is ever in flight. A change during a save does not start a second — it is held
 *     and sent after the first settles, so writes cannot land out of order.
 *   • Every save carries a sequence number. A response whose sequence is not the latest issued is
 *     DISCARDED: it describes a version of the form that no longer exists, and letting it set
 *     "Saved" would tell the operator their newest edit was persisted when it was not.
 *   • Values equal to what the server last confirmed are not written at all. Autosave must not
 *     manufacture audit rows for edits nobody made.
 *   • `flush` is what Save and Exit and Save and Continue call: it cancels the debounce and forces
 *     the pending change out now, so leaving the page cannot outrun the timer.
 */

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface AutosaveSnapshot {
  state: SaveState
  /** True while anything typed has not yet been confirmed by the server. */
  dirty: boolean
  /** The message to show, and to announce. Empty when there is nothing to say. */
  message: string
  /** Set only in the error state, so a retry can be offered. */
  error: string | null
}

export interface SaveRequest<T> {
  /** The sequence number this request was issued under. Echoed back to `settle`. */
  seq: number
  /** Only the fields that actually differ from the last confirmed values. */
  patch: Partial<T>
}

const MESSAGES: Record<SaveState, string> = {
  idle: '',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
}

export interface AutosaveOptions {
  /** How long after the last keystroke to write. */
  debounceMs?: number
}

export const DEFAULT_DEBOUNCE_MS = 1000

/**
 * Fields that differ between two records, by strict comparison of their string forms.
 *
 * Deliberately compares rendered values rather than raw ones: a number typed back to the same number
 * is not a change, and re-writing it would produce an audit row describing an edit nobody made.
 */
export function changedFields<T extends Record<string, unknown>>(next: T, confirmed: T): Partial<T> {
  const patch: Partial<T> = {}
  for (const key of Object.keys(next) as (keyof T)[]) {
    const a = next[key]
    const b = confirmed[key]
    if (String(a ?? '') !== String(b ?? '')) patch[key] = a
  }
  return patch
}

export class AutosaveEngine<T extends Record<string, unknown>> {
  private confirmed: T
  private current: T
  private state: SaveState = 'idle'
  private error: string | null = null
  private seq = 0
  /** The sequence currently in flight, or null. Only one at a time, by construction. */
  private inFlight: number | null = null
  /** Set when the debounce has elapsed (or was flushed) and a write is owed. */
  private due = false
  private timerAt: number | null = null
  readonly debounceMs: number

  constructor(initial: T, opts: AutosaveOptions = {}) {
    this.confirmed = { ...initial }
    this.current = { ...initial }
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
  }

  snapshot(): AutosaveSnapshot {
    return {
      state: this.state,
      dirty: this.isDirty(),
      message: MESSAGES[this.state],
      error: this.error,
    }
  }

  /** What the form currently holds. */
  values(): T { return { ...this.current } }

  /** What the server has confirmed. A refresh restores exactly this. */
  confirmedValues(): T { return { ...this.confirmed } }

  isDirty(): boolean {
    return Object.keys(changedFields(this.current, this.confirmed)).length > 0
  }

  /**
   * Whether leaving now would lose something.
   *
   * Unconfirmed means unsaved. A save in flight has not been acknowledged and can still fail, and
   * navigating away can abandon the request — so it warns. A change the server has confirmed does
   * not, which keeps the dialog rare enough that people still read it: Save and Exit flushes and
   * waits for confirmation, so the ordinary way out never triggers it.
   */
  shouldWarnOnLeave(): boolean { return this.isDirty() }

  /** A field changed. Restarts the debounce from `now`. */
  change(key: keyof T, value: T[keyof T], now: number): void {
    this.current = { ...this.current, [key]: value }
    if (this.isDirty()) {
      this.state = this.state === 'saving' ? 'saving' : 'dirty'
      this.error = null
      this.timerAt = now + this.debounceMs
    } else {
      // Typed back to the confirmed value: there is nothing to write, so nothing is pending.
      this.timerAt = null
      this.due = false
      if (this.state !== 'saving') this.state = 'saved'
    }
  }

  /**
   * Time passed. Returns a request when the debounce has elapsed and nothing is in flight.
   *
   * Returns null while a save is already running: the change is held, not raced.
   */
  tick(now: number): SaveRequest<T> | null {
    if (this.timerAt != null && now >= this.timerAt) {
      this.timerAt = null
      this.due = true
    }
    return this.issue()
  }

  /**
   * Force the pending change out now, cancelling the debounce.
   *
   * Save and Exit and Save and Continue both call this. Returns null when there is nothing to write
   * or a save is already carrying the change.
   */
  flush(): SaveRequest<T> | null {
    this.timerAt = null
    this.due = true
    return this.issue()
  }

  private issue(): SaveRequest<T> | null {
    if (!this.due) return null
    if (this.inFlight != null) return null
    const patch = changedFields(this.current, this.confirmed)
    if (Object.keys(patch).length === 0) {
      // Nothing actually differs. No write, no audit row.
      this.due = false
      if (this.state !== 'saved') this.state = this.state === 'error' ? 'error' : 'saved'
      return null
    }
    this.due = false
    this.seq += 1
    this.inFlight = this.seq
    this.state = 'saving'
    // The values as they were WHEN SENT, so the response confirms exactly this and nothing later.
    this.sent.set(this.seq, { ...this.current })
    return { seq: this.seq, patch }
  }

  private sent = new Map<number, T>()

  /**
   * A save came back.
   *
   * A response for anything other than the newest issued sequence is discarded: it describes a
   * version of the form that has since been superseded, and honouring it would either announce a
   * save that no longer reflects the fields or clear a dirty flag that should still be set.
   */
  settle(seq: number, result: { ok: boolean; error?: string }, now: number): SaveRequest<T> | null {
    const sentValues = this.sent.get(seq)
    this.sent.delete(seq)

    if (seq !== this.seq) {
      // Stale. Clear the slot if it was the in-flight one, but change nothing the operator sees.
      if (this.inFlight === seq) this.inFlight = null
      return this.issue()
    }

    this.inFlight = null

    if (!result.ok) {
      this.state = 'error'
      this.error = result.error ?? 'The change could not be saved.'
      // The values stay dirty and stay on screen. A failed autosave must never discard what was typed.
      return null
    }

    if (sentValues) this.confirmed = sentValues
    this.error = null
    this.state = this.isDirty() ? 'dirty' : 'saved'

    // Anything typed while that save was running is written now, in order.
    if (this.isDirty()) {
      this.timerAt = now + this.debounceMs
      return null
    }
    return null
  }

  /** Retry after a failure, without waiting for the debounce. */
  retry(): SaveRequest<T> | null {
    if (this.state !== 'error') return null
    this.error = null
    return this.flush()
  }
}
