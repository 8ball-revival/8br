/**
 * Shared identity-resolution service.
 *
 * SINGLE place that maps a competition handle/display-name to a canonical player.
 * Both the all-time (season-stats) and annual (annual-rankings) services use this,
 * so every derived statistic resolves identities consistently.
 *
 * Owner-verified corrections encoded here:
 *  - Neo / Starkiller: id "neo", display "Neo", primary handle Starkiller. The
 *    archive lumped these under id P1316 ("Luis"); we remap P1316 → neo and force
 *    the confirmed Neo handles → neo. The real Luis (id "luis") is untouched.
 *  - pool.instinct → MJ_The_King (P0512 → P1791), display "MJ".
 *  - Peter / eskimo: id "peter".
 *  - i_am_almost_god is a SHARED historical account (Craig + Neo) — never a
 *    universal alias; resolved per-record from the display name.
 *  - Explicit exceptions (deep.cerebro, real_creampuff, xlx_cerebro_xlx, luisj_barreto,
 *    ll_chex_ll, trustneo) keep their own archive ids — no override touches them.
 */
import aliasData from './player-aliases.json'
import { buildIdentityOverrides, CONFIRMED_ID_REMAPS } from '@/lib/identity/roster-map'

const RAW_H2ID = aliasData.handleToId as Record<string, string>
const RAW_ID2NAME = aliasData.idToName as Record<string, string>

const nk = (s?: string | null) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const clean = (s?: string | null) => (s || '').replace(/^#?\d+[.\s]\s*/, '') // strip seed prefixes
const key = (s?: string | null) => nk(clean(s))

// Confirmed Neo handles (unconditional → id "neo").
const NEO_HANDLES = [
  'neo', 'xGodNeox', 'cockyneo', 'pool_king_neo', 'Starkiller', 'stepatdis', 'kingjluis',
  'darkg0d', 'heraldoftitans', 'shadowman', 'mrmarvel', 'anarchistman', 'ooofranchiseooo',
  'captenforcer', 'eldrunken', 'rufferman24',
]
const FORCE: Record<string, string> = {}
for (const h of NEO_HANDLES) FORCE[key(h)] = 'neo'
FORCE[key('pool.instinct')] = 'P1791' // → MJ_The_King
// Other owner-confirmed merges (so they resolve even when the broad archive map is
// off, e.g. the annual/current-era service). Ids match the archive map for consistency.
for (const h of ['mynameiseskimo', 'eskimo']) FORCE[key(h)] = 'peter'
for (const h of ['sixohtwo', 'havok']) FORCE[key(h)] = 'P0969' // Kevin
for (const h of ['deep.cerebro', 'real_creampuff', 'xlx_cerebro_xlx']) FORCE[key(h)] = 'luis'
for (const h of ['mvp_sicc', 'good-faith', 'manutd_', 'underdogg_']) FORCE[key(h)] = 'ant'
// Derrick's stylized current-era cup gamertag. Owner-confirmed (2026-08-02): this handle,
// its P1256 archive id, and the roster canonical P1022 ("poolist") are all ONE Derrick, so
// it resolves straight to P1022 and P1256 is folded in via CONFIRMED_ID_REMAPS below.
// key() normalises the fancy glyphs to a stable key.
FORCE[key('GØĐⱠłKɆ.÷')] = 'P1022'
// l_Mr_CC_l and xlx_CC_xlx are Craig (owner-confirmed) → his current, established id
// P1567 (the #2-ranked Craig, active through 2026). Other historical "Craig" archive
// ids are NOT merged (that would be a guess).
for (const h of ['l_Mr_CC_l', 'xlx_CC_xlx']) FORCE[key(h)] = 'P1567'
// Iantunstall (2026) is Ian Tunstall from the archive — his 2009 play is split across
// P1279 (tunstall_time) and P1281 (itstunstallfewls); unify them here. All handles
// literally read "Tunstall", so this is evidenced, not guessed.
for (const h of ['Iantunstall', 'tunstall_fewls']) FORCE[key(h)] = 'P1279'
// Owner-confirmed: Mr.Gaz (2026) + mrgaz86 (2025) are Gary, the same person as every
// archive Gary/Gaz/Gazy id (remapped below) → canonical 'gary'.
for (const h of ['Mr.Gaz', 'mrgaz86']) FORCE[key(h)] = 'gary'

// Remap whole archive ids to a canonical id (catches every alias of that id).
// P0512 = pool.instinct, P0104 = xlx_pool_instinct_xlx ("Mj", 2005-s4) — both are
// MJ_The_King (P1791). P1316 (mislabelled "Luis" in the archive) = Neo.
const ID_REMAP: Record<string, string> = { P1316: 'neo', P0512: 'P1791', P0104: 'P1791', P1281: 'P1279' }
// Owner-confirmed: every archive Gary/Gaz/Gazy id is the same person → canonical 'gary'.
const GARY_IDS = ['P0062', 'P0352', 'P0353', 'P0354', 'P0355', 'P0356', 'P0357', 'P0358', 'P0769', 'P0770', 'P1038', 'P1649', 'P1892']
for (const id of GARY_IDS) ID_REMAP[id] = 'gary'
// Owner-confirmed: Serena / _ladyluck_ (P1860 — ladyluck, safeties, serena, xserenax, …)
// is the current player Travis (P1853). Travis replaces all mention of Serena.
ID_REMAP.P1860 = 'P1853'
// Owner-confirmed (2026-08-05): the two 1-title "Stu" champions are ONE person —
// zl_Stu_lz (P0140, 2009 S6) and scotpool (P1713, 2011 S4). Fold P1713 into P0140 so Stu
// counts as a 2× champion. The other "Stu"-named archive ids (P0922, P1166, P0141) are
// different players and are intentionally NOT merged.
ID_REMAP.P1713 = 'P0140'
// Owner-confirmed (2026-08-05): the two 1-title "CK" champions are ONE person —
// Xx_CK_xX (P1765) and b0rn.gr3at (P1198). Fold P1198 into P1765 so CK counts as a 2× champion.
ID_REMAP.P1198 = 'P1765'
// Owner-confirmed (2026-08-05): two "Chris" champions are ONE person — chris.dogg (P0258,
// 2 titles) and ll_chris.dogg_ll (P0702, 1 title). Fold P0702 into P0258 → Chris is a 3×
// champion. The unrelated third Chris (new.zealand, P0261) is intentionally NOT merged.
ID_REMAP.P0702 = 'P0258'
// Owner-confirmed (fixed-accounts mapping, rows 23 + 27): the ranked "Brian" (archive id P1757 —
// handles spcshogun/joosedup/…) and "fsm-brian" (P0975, the roster canonical for Brian) are the SAME
// person → fold the extra P1757 row into P0975 so they are ONE ranking / one profile.
ID_REMAP.P1757 = 'P0975'
// Owner-confirmed archive-id merges from the authoritative roster (e.g. P1256 → Derrick).
for (const [from, to] of Object.entries(CONFIRMED_ID_REMAPS)) ID_REMAP[from] = to
// Canonical display names for corrected/canonical ids.
// P1183 = cue.ball: owner-confirmed his name is James (the archive idToName had "JD").
const NAME: Record<string, string> = { neo: 'Neo', P1791: 'MJ', peter: 'Peter', craig: 'Craig', P1256: 'Derrick', gary: 'Gary', P1183: 'James' }
// Shared historical accounts — resolved per record by display name, never a global alias.
const SHARED = new Set([key('i_am_almost_god')])
// Handles the owner has explicitly flagged as unresolved (excluded until reviewed).
const FLAGGED = new Set<string>()

// ---------------------------------------------------------------------------
// AUTHORITATIVE ROSTER MAPPING → career aggregation (owner-provided). Every SAFE alias
// key resolves to the person's canonical id so their whole CAREER aggregates to one
// profile; ambiguous handles (unicode / very short / placeholder / shared) are skipped and
// surfaced for manual confirmation. This affects ONLY career/rankings resolution — it never
// changes historical competition PRESENTATION (brackets/standings render stored, as-played
// names). Display name = the person's current CueVerse ID.
// ---------------------------------------------------------------------------
// Exact-raw (lowercased, trimmed) handle → canonical id, for owner-confirmed UNICODE handles
// that normalize to an empty key (e.g. Missy's ℳ𝒾𝓼𝓈𝓎♥︎, Derrick's ₲ØĐⱠł₭Ɇ₊⊹ / 💎).
const RAW_FORCE: Record<string, string> = {}
{
  const ov = buildIdentityOverrides()
  for (const [k, id] of Object.entries(ov.force)) {
    FORCE[k] = id
    const archiveId = RAW_H2ID[k]
    if (archiveId && archiveId !== id) ID_REMAP[archiveId] = id // fold that archive id into the person
  }
  for (const [raw, id] of Object.entries(ov.rawForce)) RAW_FORCE[raw] = id
  Object.assign(NAME, ov.name)
}

export interface Identity {
  id: string
  name: string
  ok: boolean // false = unresolved/flagged (excluded from public totals)
}

const canonId = (id: string) => ID_REMAP[id] ?? id
const nameFor = (id: string, fallback: string) => NAME[id] ?? RAW_ID2NAME[canonId(id)] ?? RAW_ID2NAME[id] ?? fallback

/**
 * Resolve a competitor to a canonical identity.
 * @param opts.unknownAsSelf true → an unmatched handle becomes its own player
 *   (current-era gamertags); false → it's flagged unresolved.
 * @param opts.useArchiveMap (default true) → also consult the broad archive alias
 *   map (player-aliases.json). Owner-confirmed merges (FORCE/ID_REMAP) and shared/
 *   flagged rules ALWAYS apply. The current-era annual passes false so 2026 gamertags
 *   keep their own identity instead of being guess-merged into a same-handle archive
 *   player — cross-era merges must be owner-confirmed, not inferred from the map.
 */
export function resolveIdentity(
  handle?: string | null,
  name?: string | null,
  opts: { unknownAsSelf?: boolean; useArchiveMap?: boolean } = {},
): Identity | null {
  const useMap = opts.useArchiveMap ?? true
  // Shared account: resolve strictly from the record's display name.
  if (SHARED.has(key(handle))) {
    const dn = key(name)
    if (dn === 'neo' || dn === 'luis') return { id: 'neo', name: 'Neo', ok: true }
    if (dn === 'craig') return { id: 'craig', name: 'Craig', ok: true }
    return { id: 'unresolved:iamalmostgod', name: name ?? 'i_am_almost_god', ok: false }
  }
  // Owner-flagged unresolved handles.
  const kh = key(handle)
  if (kh && FLAGGED.has(kh)) return { id: `unresolved:${kh}`, name: name ?? handle ?? kh, ok: false }

  // Owner-confirmed unicode handles (empty normalized key) — match the exact raw string.
  for (const raw of [handle, name]) {
    const rk = (raw ?? '').trim().toLowerCase()
    if (rk && RAW_FORCE[rk]) return { id: RAW_FORCE[rk], name: nameFor(RAW_FORCE[rk], raw as string), ok: true }
  }

  for (const raw of [handle, name]) {
    const k = key(raw)
    if (!k) continue
    if (FLAGGED.has(k)) return { id: `unresolved:${k}`, name: name ?? handle ?? k, ok: false }
    if (FORCE[k]) return { id: FORCE[k], name: nameFor(FORCE[k], raw as string), ok: true }
    if (useMap && RAW_H2ID[k]) {
      const id = canonId(RAW_H2ID[k])
      return { id, name: nameFor(id, raw as string), ok: true }
    }
  }
  const k = key(handle) || key(name)
  if (!k) return null
  if (opts.unknownAsSelf) return { id: k, name: (name ?? handle ?? k) as string, ok: true }
  return { id: `unresolved:${k}`, name: (name ?? handle ?? k) as string, ok: false }
}

/**
 * PUBLIC display scrub. Given a record's raw (handle, name), return what the public
 * site may show. Records belonging to Neo render ONLY as "Neo / Starkiller" — every
 * historical handle (xGodNeox, neo, i_am_almost_god-when-mine, …) is hidden. All other
 * players are returned unchanged. Source data keeps the original handle for internal
 * resolution/provenance; this only governs presentation.
 */
export function scrubForPublic(
  handle?: string | null,
  name?: string | null,
): { name: string; handle?: string } {
  const r = resolveIdentity(handle, name, { unknownAsSelf: true })
  if (r && r.id === 'neo') return { name: 'Neo', handle: 'Starkiller' }
  return { name: (name ?? handle ?? '') as string, handle: handle ?? undefined }
}

