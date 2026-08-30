/**
 * The marker every session the development E2E route issues carries.
 *
 * ── Why it is here and not in the route ─────────────────────────────────────────────────────────
 * A Next route file may export only its handlers. Exporting anything else — even a constant — makes
 * the production build fail its route type check with a message about an index signature and
 * `never`, which is a long way from "you exported a string from a route". `tsc --noEmit` does not
 * catch it, because the check lives in the generated route types that only `next build` writes.
 *
 * So it lives in an ordinary module, where the route, a cleanup script and a test can all import it
 * from one place rather than each holding their own copy of a string that has to match.
 *
 * ── What it is ──────────────────────────────────────────────────────────────────────────────────
 * A valid UUID first group, so a session id carrying it is still well-formed, and unmistakable, so a
 * sweep can never catch a session somebody created by signing in. Nothing else in the application
 * produces one.
 */
export const E2E_SESSION_PREFIX = 'e2e5e551'
