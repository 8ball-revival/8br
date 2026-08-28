/**
 * A hard stop on the tooling that is no longer allowed to run.
 *
 * ── Why these are retired ───────────────────────────────────────────────────────────────────────
 * The database serving 8br.gg is the sole authority for real data. Nothing may restore over it,
 * seed into it, import into it, reconstruct it, or merge identities inside it. The scripts that
 * import them are kept in the repository because they are the record of how the archive was built —
 * deleting them would erase that — but they must never execute again.
 *
 * A comment saying "do not run this" is not a guard. This is: importing it throws, so the refusal
 * happens whether the script is run deliberately, by tab-completion, or by a future automation that
 * never read the comment.
 *
 * Import it as the FIRST line of anything retired:
 *
 *   import './_retired.mjs'
 */
const reason = process.env.RETIRED_REASON
  || 'This script belongs to the retired archive and reconstruction tooling.'

throw new Error(
  [
    '',
    '  ══ REFUSED ═══════════════════════════════════════════════════════════════',
    `  ${reason}`,
    '',
    '  The database serving 8br.gg is the sole authority for real competition data.',
    '  It is never restored over, seeded, imported into, reconstructed or merged.',
    '',
    '  Development uses its own fixture database and its own dummy data:',
    '      npm run dev:reset',
    '',
    '  See docs/DEVELOPMENT.md — "Data that must never move".',
    '  ══════════════════════════════════════════════════════════════════════════',
    '',
  ].join('\n'),
)
