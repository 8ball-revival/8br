/**
 * AUTHORITATIVE identity mapping for the initial account migration (owner-provided).
 *
 * One entry per PERSON. `current` is the current/default CueVerse ID (null = unknown).
 * `aliases` are additional CueVerse IDs the person has used. Every handle becomes a
 * searchable alias on the single canonical Player profile; the first CueVerse ID becomes
 * the current display ID. Duplicate profiles are merged into one. Do NOT guess anyone not
 * listed here. Historical competitions still display the ID played with (as-played).
 *
 * This is the source of truth consumed by `scripts/migrate-identity-map.mts`.
 */
export interface IdentityEntry {
  person: string
  current: string | null // current/default CueVerse ID; null when unknown
  aliases: string[]
}

export const IDENTITY_MAP: IdentityEntry[] = [
  { person: 'Missy', current: '_BanQ-ChiQ_', aliases: ['ℳ𝒾𝓼𝓈𝓎♥︎', '_Tarantula_69', 'Sassy_Banker'] },
  { person: 'Saqs', current: '-NOOB-', aliases: ['S_U_K_I_O_O'] },
  { person: 'Arsh', current: 'W T F', aliases: ['a.r.s.h', 'ArsH_', 'Bye_all_c_ya'] },
  { person: 'Adam', current: 'Adambundy', aliases: [] },
  { person: 'Ebs', current: 'Bitch', aliases: [] },
  { person: 'Tim', current: 'Black_Ball', aliases: ['Black_Jesus'] },
  { person: 'Brian', current: 'fsm-brian', aliases: [] },
  { person: 'Brice', current: 'Bricycle', aliases: ['Ghostshot'] },
  { person: 'Cameron', current: 'Cam', aliases: ['Cameron90', 'legendskillz'] },
  { person: 'Chirag', current: 'Jabronni16', aliases: [] },
  { person: 'Craig', current: 'l_Mr_CC_l', aliases: ['P00l_BeAsT', 'xx_aimer.banks_xx', 'xlx_CC_xlx'] },
  { person: 'David', current: null, aliases: [] },
  { person: 'Derrick', current: 'poolist', aliases: ['₲ØĐⱠł₭Ɇ₊⊹', '💎', 'D3rrlck'] },
  { person: 'Faisal', current: 'faisal', aliases: [] },
  { person: 'Gary', current: 'mr.gaz', aliases: [] },
  { person: 'Sterlo', current: 'HuStLeR', aliases: [] },
  { person: 'Ian', current: 'Iantunstall', aliases: [] },
  { person: 'James', current: 'Drilled___', aliases: [] },
  { person: 'Javier', current: 'Javi_8', aliases: [] },
  { person: 'JC', current: 'JC', aliases: [] },
  { person: 'Jefe', current: 'JEFE_122', aliases: [] },
  { person: 'Josh', current: null, aliases: [] },
  { person: 'Leigh', current: 'leighjohn__', aliases: ['LJ'] },
  { person: 'Nakz', current: 'Nakz_', aliases: ['_1_'] },
  { person: 'Chris C', current: 'o_aig_o', aliases: ['AIG', 'aig'] },
  { person: 'George', current: 'Ogges', aliases: [] },
  { person: 'Petey', current: 'eskimo', aliases: [] },
  { person: 'Ryan', current: 'PFB', aliases: ['THE_PFB'] },
  { person: 'Travis', current: 'Player', aliases: ['Travis'] },
  { person: 'Sean', current: 'Lilsparky', aliases: [] },
  { person: 'Sid', current: 'Sid', aliases: [] },
  { person: 'Thomas', current: 'ThomasPoddy', aliases: [] },
  { person: 'Hicham', current: 'TRICK__D', aliases: [] },
  { person: 'Trio', current: 'TrioTheLegend', aliases: [] },
  { person: 'Koty', current: 'Xx Koty XX', aliases: ['XxKotyxX'] },
]

/**
 * Canonical stats id per person (== the id the ranking/career resolver aggregates to, and
 * the linked Player's legacyPlayerId). Existing archive ids for players already in the
 * resolver; a normalized slug of the current CueVerse ID for newly-created people; null
 * where there is no known identity yet. Used by both the stats resolver (identity.ts) and
 * the DB migration so a person's whole career resolves to ONE id.
 */
export const CANONICAL: Record<string, string | null> = {
  Missy: 'banqchiq', Saqs: 'P1846', Arsh: 'wtf', Adam: 'adambundy', Ebs: 'bitch',
  Tim: 'blackball', Brian: 'P0975', Brice: 'bricycle', Cameron: 'P1603', Chirag: 'P0029',
  Craig: 'P1567', David: null, Derrick: 'P1022', Faisal: 'P1786', Gary: 'gary',
  Sterlo: 'hustler', Ian: 'P1279', James: 'drilled', Javier: 'javi8', JC: 'P1486',
  Jefe: 'jefe122', Josh: null, Leigh: 'leighjohn', Nakz: 'nakz', 'Chris C': 'oaigo',
  George: 'P1526', Petey: 'peter', Ryan: 'pfb', Travis: 'P1853', Sean: 'lilsparky',
  Sid: 'P1262', Thomas: 'thomaspoddy', Hicham: 'trickd', Trio: 'triothelegend', Koty: 'xxkotyxx',
}

/** Alias keys that are too ambiguous to auto-aggregate (unicode, ≤2 chars, numeric, or
 *  placeholder words). Skipped by the resolver — surfaced for manual confirmation. */
const AMBIGUOUS_PLACEHOLDERS = new Set(['player', 'bye', 'tbd', 'unknown', 'bitch', 'noob'])
const nkKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Owner-CONFIRMED aggregations that bypass the automatic ambiguity guard (2026-08-02).
 * The owner explicitly verified each `person|handle` belongs to that person. Handles with a
 * normalizable key aggregate via the normal force map; unicode handles (empty key) are
 * matched by EXACT raw string (see `rawForce`). Nothing here is guessed.
 */
const CONFIRMED_AMBIGUOUS = new Set<string>([
  'Missy|ℳ𝒾𝓼𝓈𝓎♥︎',
  'Derrick|₲ØĐⱠł₭Ɇ₊⊹', 'Derrick|💎',
  'Saqs|-NOOB-', 'Ebs|Bitch', 'Travis|Player',
  'JC|JC', 'Leigh|LJ', 'Nakz|_1_',
])

/**
 * Owner-confirmed archive-id → canonical-id merges: fold a whole archive identity (and all
 * its aliases) into the person. P1256 = Derrick's stylized `GØĐⱠłKɆ.÷` cup handle → poolist.
 */
export const CONFIRMED_ID_REMAPS: Record<string, string> = {
  P1256: 'P1022', // GØĐⱠłKɆ.÷ (Derrick's current-era cup play) → Derrick / poolist
  P1743: 'banqchiq', // plain "Missy" competition identity → Missy
  P1761: 'P1603', // plain "Cameron" competition identity → Cameron
}

const rawKey = (s: string) => s.trim().toLowerCase()

/**
 * Build the resolver overrides from the authoritative mapping — SAFE aliases only.
 * A person's canonical id aggregates every confirmed alias key. Ambiguity (unicode, very
 * short/numeric keys, placeholder words, or a key claimed by more than one person) is
 * skipped and left for manual confirmation. Returns `{ force, name, ambiguous }`.
 */
export function buildIdentityOverrides() {
  const owners = new Map<string, Set<string>>()
  for (const e of IDENTITY_MAP)
    for (const h of [e.current, ...e.aliases].filter((x): x is string => !!x)) {
      const k = nkKey(h)
      if (!k) continue
      if (!owners.has(k)) owners.set(k, new Set())
      owners.get(k)!.add(e.person)
    }
  const force: Record<string, string> = {}
  const rawForce: Record<string, string> = {} // exact-raw (lowercased) key → canonical id, for unicode handles
  const name: Record<string, string> = {}
  const ambiguous: { person: string; handle: string; reason: string }[] = []
  for (const e of IDENTITY_MAP) {
    const canon = CANONICAL[e.person]
    if (!canon) continue
    if (e.current) name[canon] = e.current // display the person under their current CueVerse ID
    for (const h of [e.current, ...e.aliases].filter((x): x is string => !!x)) {
      const k = nkKey(h)
      const confirmed = CONFIRMED_AMBIGUOUS.has(`${e.person}|${h}`)
      const reason = !k ? 'unicode' : k.length <= 2 ? 'too short' : /^\d+$/.test(k) ? 'numeric' : AMBIGUOUS_PLACEHOLDERS.has(k) ? 'placeholder word' : (owners.get(k)?.size ?? 0) > 1 ? 'shared by multiple people' : null
      if (reason && !confirmed) { ambiguous.push({ person: e.person, handle: h, reason }); continue }
      // Owner-confirmed unicode handle: no normalizable key, so match the exact raw string.
      if (!k) rawForce[rawKey(h)] = canon
      else force[k] = canon
    }
  }
  return { force, rawForce, name, ambiguous }
}

