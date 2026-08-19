/**
 * The actor identities verification suites write audit rows under.
 *
 * Verify suites create Seasons, Cups and Players, and every one of those writes an audit row. The
 * suites delete their records; historically they did not delete their trail, so the log accumulates
 * rows describing competitions that no longer exist.
 *
 * ── Why an explicit list rather than a pattern ───────────────────────────────────────────────────
 * An audit log is the one thing that cannot be reconstructed after the fact. A pattern like
 * "contains verify" or "starts with zz" would quietly widen the day somebody names a real account
 * something similar, and the failure would be silent and permanent. So the names are listed, one by
 * one, taken from the `actor` literals in `scripts/verify-*.mts`.
 *
 * ── Why the name alone is not enough ─────────────────────────────────────────────────────────────
 * A name can collide. The second half of the rule is that the row's `actorUserId` must NOT belong to
 * a real account: suites use synthetic ids (1, 940001, 950001, 990101, 990300, 990911) that were
 * never issued to anybody. A row is only a fixture row when BOTH hold — the name is a known suite
 * identity, and no account exists behind the id that wrote it.
 *
 * Anything failing either half is reported and kept. "Looks like test data" is not proof.
 */

/**
 * Actor usernames used by the verify suites, harvested from their `actor` literals.
 *
 * Single letters and short names appear here because some suites use them as competitor identities
 * that then act on their own matches. They are only ever treated as fixtures in combination with an
 * id that belongs to no account, which is what makes including them safe.
 */
export const FIXTURE_ACTORS: readonly string[] = [
  'A', 'B', 'E', 'P', 'a', 'Bye', 'earlier', 'later', 'WF9701_6', 'zzsn_p1',
  'bye-timing-verify',
  'correction-verify',
  'create-verify',
  'creator-setup-verify',
  'fa-admin',
  'field-verify',
  'gs-verify',
  'gsetup-verify',
  'identity-verify',
  'profile-verify',
  'rand-verify',
  'rand-wf-verify',
  'season-correct-verify',
  'season-full-verify',
  'season-verify',
  'swiss-verify',
  'verify',
  'verify-script',
  'verify-test-entrant',
  'vis-verify',
  'wf-verify',
  'zzbreak-verify',
  'zzdisc-verify',
  'zzmerge-verify',
  'zzpo-verify',
  'zzsx-verify',
]

const FIXTURE_SET = new Set(FIXTURE_ACTORS)

/** Whether this username is a known verify-suite identity. Half the test — see the module note. */
export function isFixtureActor(username: string | null | undefined): boolean {
  return username != null && FIXTURE_SET.has(username)
}

/**
 * The full test: a known suite identity AND an id behind which no account exists.
 *
 * `realUserIds` is the set of ids that currently exist as accounts. An id present there means a
 * person did this, whatever the row is called.
 */
export function isFixtureAuditRow(
  row: { actorUsername: string | null; actorUserId: number | null },
  realUserIds: ReadonlySet<number>,
): boolean {
  if (!isFixtureActor(row.actorUsername)) return false
  if (row.actorUserId != null && realUserIds.has(row.actorUserId)) return false
  return true
}

/**
 * Delete the audit rows a suite wrote, at the end of that suite's own cleanup.
 *
 * A verify suite that removes its Seasons but leaves its audit trail has not finished cleaning up —
 * it has left a permanent record of competitions that no longer exist, and somebody has to work out
 * later whether those rows were real. Calling this makes each suite responsible for its own mess,
 * which is the only arrangement that stays true as suites are added.
 *
 * Scoped to the usernames passed in, which are the suite's own actor identities and nothing else.
 */
export async function deleteFixtureAuditRows(
  tx: { auditLog: { deleteMany: (args: { where: { actorUsername: { in: string[] } } }) => Promise<{ count: number }> } },
  usernames: readonly string[],
): Promise<number> {
  const names = usernames.filter((n) => isFixtureActor(n))
  if (names.length === 0) return 0
  const { count } = await tx.auditLog.deleteMany({ where: { actorUsername: { in: [...names] } } })
  return count
}
