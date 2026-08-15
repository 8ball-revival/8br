/**
 * Curated pool of fun team names for RANDOM-draw tournaments.
 *
 * Two categories, combined into ONE pool with equal selection weight (a name's category never
 * affects its odds): (1) real music bands primarily associated with the 1980s / 1990s / 2000s, and
 * (2) WWE / WCW / ECW factions, stables and tag teams. Text only — no logos, no images.
 *
 * Rules enforced elsewhere:
 *  - Names are drawn WITHOUT replacement per tournament (`drawTeamNames`), so no two teams in one
 *    tournament share a name. Names may recur across separate tournaments.
 *  - A team is stored/keyed by its internal numeric ID, never by this display string. Names may
 *    contain spaces, punctuation, apostrophes, accents and numbers and must always display safely.
 *  - The pool must contain at least `MAX_SUPPORTED_TEAMS` unique entries; `assertNamePoolInvariant`
 *    fails fast if that is ever violated so we never assign a duplicate or a partial set of names.
 *
 * Maintainable: to add names, append to the relevant array. Keep every entry unique
 * (case-insensitive). The invariant test (`verify-random-teams`) guards uniqueness and the count.
 */

/** The largest number of teams any single tournament can produce (a 256-player 2v2 → 128 teams).
 *  The name pool MUST be at least this large so every team in the biggest possible bracket gets a
 *  unique name. Raise this ONLY together with the pool size. */
export const MAX_SUPPORTED_TEAMS = 128

/** Music bands primarily associated with the 1980s, 1990s and 2000s. */
const BANDS: readonly string[] = [
  "Metallica", "Nirvana", "Pearl Jam", "Soundgarden", "Alice in Chains", "Radiohead", "Oasis",
  "Blur", "R.E.M.", "U2", "The Cure", "Depeche Mode", "Duran Duran", "Bon Jovi", "Def Leppard",
  "Guns N' Roses", "Mötley Crüe", "Poison", "Twisted Sister", "Iron Maiden", "Judas Priest",
  "Megadeth", "Slayer", "Anthrax", "Pantera", "Tool", "Rage Against the Machine",
  "Red Hot Chili Peppers", "Foo Fighters", "Green Day", "The Offspring", "Blink-182", "Sum 41",
  "Weezer", "Smashing Pumpkins", "Stone Temple Pilots", "Bush", "Collective Soul", "Third Eye Blind",
  "Matchbox Twenty", "Goo Goo Dolls", "Counting Crows", "Everclear", "Fuel", "Creed", "Nickelback",
  "Staind", "Godsmack", "Disturbed", "System of a Down", "Korn", "Limp Bizkit", "Papa Roach",
  "P.O.D.", "Deftones", "Incubus", "Slipknot", "Marilyn Manson", "Nine Inch Nails", "Garbage",
  "No Doubt", "The Cranberries", "Hole", "Sonic Youth", "Dinosaur Jr.", "Pixies", "The Smiths",
  "New Order", "Joy Division", "Talking Heads", "The Police", "Dire Straits", "Journey", "Toto",
  "Foreigner", "Heart", "Van Halen", "Whitesnake", "Scorpions", "AC/DC", "Aerosmith", "ZZ Top",
  "Cheap Trick", "The Clash", "Ramones", "Sex Pistols", "Dead Kennedys", "Bad Religion", "Rancid",
  "NOFX", "Pennywise", "Social Distortion", "The Killers", "Interpol", "The Strokes",
  "The White Stripes", "The Black Keys", "Franz Ferdinand", "Kings of Leon", "Modest Mouse",
  "Death Cab for Cutie", "The Shins", "Arcade Fire", "Yeah Yeah Yeahs", "Queens of the Stone Age",
  "Audioslave", "Velvet Revolver", "A Perfect Circle", "Coldplay", "Muse", "Travis", "Keane",
  "Snow Patrol", "Jimmy Eat World", "Dashboard Confessional", "Taking Back Sunday", "Brand New",
  "Coheed and Cambria", "Thrice", "Alkaline Trio", "My Chemical Romance", "Fall Out Boy", "Paramore",
  "Panic! at the Disco", "The All-American Rejects", "Yellowcard", "New Found Glory", "Simple Plan",
  "Good Charlotte", "The Used", "Story of the Year", "Hoobastank", "Seether", "Shinedown",
  "Three Days Grace", "Breaking Benjamin", "Chevelle", "Mudvayne", "Drowning Pool", "Sevendust",
  "Static-X", "Fear Factory", "Rob Zombie", "Ministry", "Faith No More", "Primus", "Cake",
  "Sublime", "311", "The Mars Volta", "At the Drive-In", "Rise Against", "Thursday", "Underoath",
  "Killswitch Engage", "Avenged Sevenfold", "Lamb of God",
]

/** WWE / WCW / ECW factions, stables and tag teams (many became part of WWE history). */
const FACTIONS: readonly string[] = [
  "D-Generation X", "Evolution", "The Shield", "The Hardy Boyz", "nWo", "The New Day",
  "The Dudley Boyz", "The Nexus", "The Wyatt Family", "The Brood", "The Nation of Domination",
  "The Hart Foundation", "The Corporation", "The Ministry of Darkness", "The Right to Censor",
  "The Radicalz", "The Four Horsemen", "The Fabulous Freebirds", "The Rockers", "The Legion of Doom",
  "The Road Warriors", "Demolition", "The Natural Disasters", "Money Inc.", "The Steiner Brothers",
  "Harlem Heat", "The Outsiders", "The Wolfpac", "The Filthy Animals", "The Flock",
  "The Dangerous Alliance", "The Varsity Club", "The Blue World Order", "The Triple Threat",
  "The Impact Players", "The Public Enemy", "The Eliminators", "The Gangstas",
  "The Full Blooded Italians", "The Kliq", "The Bodydonnas", "The Headshrinkers", "Los Guerreros",
  "The World's Greatest Tag Team", "The Basham Brothers", "La Résistance", "3-Minute Warning",
  "The Un-Americans", "Legacy", "The Corre", "The Social Outcasts", "The League of Nations",
  "The Miztourage", "The Bar", "The Usos", "The Revival", "The Ascension", "American Alpha",
  "Breezango", "The Vaudevillains", "SAnitY", "The Undisputed Era", "Imperium", "The Hurt Business",
  "Retribution", "The Judgment Day", "The Bloodline", "Alpha Academy", "Legado del Fantasma",
  "Too Cool", "The Mean Street Posse", "The Disciples of Apocalypse", "Los Boricuas",
  "The J.O.B. Squad", "The Alliance", "The Spirit Squad", "Rated-RKO", "The Mega Powers",
  "The Twin Towers", "The Colossal Connection", "The Brain Busters", "Strike Force",
  "The Killer Bees", "The British Bulldogs", "The Hart Dynasty", "3MB", "The Prime Time Players",
  "The Lucha House Party", "Team Hell No", "The Brothers of Destruction", "The Straight Edge Society",
  "The Authority", "The Club", "The Bálor Club",
]

/** One combined pool; category does not affect selection odds (every name is equally likely). */
export const TEAM_NAME_POOL: readonly string[] = [...BANDS, ...FACTIONS]

/** Case-insensitive de-dup key. */
const nameKey = (n: string) => n.trim().toLowerCase()

/**
 * Fail-fast invariant: the pool has no case-insensitive duplicates AND is at least
 * `MAX_SUPPORTED_TEAMS` long. Called before any RANDOM generation so we never assign duplicate or
 * partial names — better to refuse than to produce a broken tournament.
 */
export function assertNamePoolInvariant(): void {
  const seen = new Set<string>()
  for (const n of TEAM_NAME_POOL) {
    const k = nameKey(n)
    if (seen.has(k)) throw new Error(`Team name pool contains a duplicate: "${n}"`)
    seen.add(k)
  }
  if (TEAM_NAME_POOL.length < MAX_SUPPORTED_TEAMS) {
    throw new Error(`Team name pool has ${TEAM_NAME_POOL.length} names but MAX_SUPPORTED_TEAMS is ${MAX_SUPPORTED_TEAMS}. Add more names before generating.`)
  }
}

/**
 * Draw `count` unique team names WITHOUT replacement, using the caller's secure shuffle. Fails fast
 * (before creating anything) if the pool cannot cover the request — never returns duplicates or a
 * short list. `shuffle` must be the cryptographically-secure shuffle so the selection is unbiased
 * and unpredictable.
 */
export function drawTeamNames(count: number, shuffle: <T>(items: readonly T[]) => T[]): string[] {
  assertNamePoolInvariant()
  if (count < 0) throw new Error('drawTeamNames: count must be non-negative')
  if (count > TEAM_NAME_POOL.length) {
    throw new Error(`Cannot draw ${count} unique team names from a pool of ${TEAM_NAME_POOL.length}.`)
  }
  return shuffle(TEAM_NAME_POOL).slice(0, count)
}
