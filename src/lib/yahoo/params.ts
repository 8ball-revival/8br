/**
 * The namespace the archive's ladder parameters live under.
 *
 * ── Why it is here and not beside the component ──────────────────────────────────────────────────
 * It used to be exported from the workspace, which is a `'use client'` module. A Server Component
 * importing a plain constant from a client module does not get the constant: the module is never
 * evaluated on the server, so the import resolves to a client reference. The page was therefore
 * prefixing its parameter lookups with something that was not the string `r`, every lookup missed,
 * and the archive silently rendered the unfiltered ladder no matter what the URL said — while the
 * identical code in a route handler worked, because that one imported the value from a real module.
 *
 * Shared constants that both sides read belong in a module with no directive at all.
 *
 * ── What it is for ───────────────────────────────────────────────────────────────────────────────
 * `/yahoo?season=…` means the historical season the page has open. The ladder on the same page also
 * has a season FILTER. Two different questions with the same natural name, so the ladder's keys are
 * prefixed — `rseason`, `rfrom`, `rto` — and the page keeps the bare ones. The Rankings page passes
 * no prefix, and its URLs are unchanged.
 */
export const YAHOO_PARAM_PREFIX = 'r'
