/**
 * The tokens Display Lab is allowed to move, and what each one actually does.
 *
 * ── Why this file exists ────────────────────────────────────────────────────────────────────────
 * The stylesheet declares 183 colour variables. Exposing 183 colour pickers would not be a design
 * system, it would be a wall of controls that nobody can hold in their head and that makes an
 * unusable site reachable in one click. Exposing one — which is what Display Lab did, and why only
 * the bar above the Rankings responded to it — is not a design system either.
 *
 * This is the middle: a curated set of roles, chosen because the rest of the stylesheet DERIVES from
 * them. `--card` is `var(--graphite-raised)`; `--foreground` is `var(--clean-white)`; `--nav-active`
 * is `var(--signal)`. Move the primitive and every surface that referenced it moves together,
 * because the cascade was already written that way. So a control here is a decision about the whole
 * site rather than about one component, which is the difference between a design system and a
 * find-and-replace.
 *
 * ── Why some roles appear even though they derive ───────────────────────────────────────────────
 * A few are listed separately BECAUSE somebody will legitimately want to break the derivation — a
 * theme where the navigation is not the page colour, or where the primary button is not the accent.
 * Those are real design decisions and they get their own control. Everything else inherits, and the
 * panel says so.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────────────────────────
 * Rating-tier colours, streak colours and the bracket palette. They encode MEANING — gold is 1600+,
 * green is a winning run — and a reader who learns them on one page has to find them true on the
 * next. They are documented as intentional exceptions in `docs/theme-tokens.md` rather than offered
 * as pickers.
 */

export type TokenGroup =
  | 'foundations'
  | 'typography'
  | 'borders'
  | 'brand'
  | 'navigation'
  | 'controls'
  | 'tables'
  | 'competition'
  | 'editorial'
  | 'homepage'
  | 'footer'
  | 'imagery'

export interface ThemeToken {
  /** Stable key, stored in settings. Never rendered. */
  key: string
  /** The custom property this writes. */
  css: string
  /** What an Owner sees. */
  label: string
  group: TokenGroup
  /**
   * The built-in value, as declared in globals.css.
   *
   * Resolved to a literal rather than a `var()` chain: the panel has to show a swatch before
   * anything is overridden, and it cannot resolve a variable that only exists in the document.
   */
  fallback: string
  /** Plain language. What moving this actually changes, in terms of things somebody can see. */
  effect: string
  /**
   * Tokens that follow this one unless they are themselves overridden.
   *
   * Used by the panel to say "12 other things inherit from this", and by the contrast engine to
   * know that changing a primitive moves every pairing derived from it.
   */
  cascadesTo?: string[]
}

export const THEME_GROUPS: { id: TokenGroup; label: string; blurb: string }[] = [
  { id: 'foundations', label: 'Foundations', blurb: 'The grounds everything else sits on.' },
  { id: 'typography', label: 'Typography', blurb: 'The colours text is set in, and the faces it uses.' },
  { id: 'borders', label: 'Borders & depth', blurb: 'Rules, edges, focus and shadow.' },
  { id: 'brand', label: 'Brand accents', blurb: 'The accent, and the colours that carry meaning.' },
  { id: 'navigation', label: 'Navigation', blurb: 'The header bar and the current page.' },
  { id: 'controls', label: 'Buttons & forms', blurb: 'Filled actions, inputs and their text.' },
  { id: 'tables', label: 'Tables & rankings', blurb: 'Table headers, rows and the ranking rail.' },
  { id: 'competition', label: 'Seasons, tournaments & brackets', blurb: 'Competition surfaces.' },
  { id: 'editorial', label: 'Articles & achievements', blurb: 'The Break, news plaques and plaque medals.' },
  { id: 'homepage', label: 'Homepage modules', blurb: 'The hero, the rail and the record panel.' },
  { id: 'footer', label: 'Footer & status', blurb: 'The totals bar and the footer.' },
  { id: 'imagery', label: 'Image treatments', blurb: 'How photography is darkened, never what it contains.' },
]

export const THEME_TOKEN_REGISTRY: ThemeToken[] = [
  // ── Foundations ───────────────────────────────────────────────────────────────────────────────
  {
    key: 'void', css: '--void', label: 'Page canvas', group: 'foundations', fallback: '#050607',
    effect: 'The ground behind every page. Also the navigation bar and the inset wells unless those are set separately.',
    cascadesTo: ['--background', '--bracket-canvas', '--nav-bg'],
  },
  {
    key: 'graphite', css: '--graphite', label: 'Panel surface', group: 'foundations', fallback: '#0b0f12',
    effect: 'The first step up from the page: bordered panels, the news column, the Break card, popovers.',
    cascadesTo: ['--surface', '--popover'],
  },
  {
    key: 'graphiteRaised', css: '--graphite-raised', label: 'Elevated surface', group: 'foundations', fallback: '#14191d',
    effect: 'Cards and rows inside a panel, and the second elevation generally.',
    cascadesTo: ['--card', '--muted', '--secondary', '--bracket-surface'],
  },
  {
    key: 'plaque', css: '--surface-plaque', label: 'Plaque surface', group: 'foundations', fallback: '#171c21',
    effect: 'Achievement plaques and news rows — the surfaces bounded by steel rather than by a quiet line.',
  },
  {
    key: 'inset', css: '--surface-inset', label: 'Inset surface', group: 'foundations', fallback: '#080b0d',
    effect: 'Wells pressed into a panel: the statistics bar, the scoreboard strip, video letterboxing.',
  },
  {
    key: 'hover', css: '--accent', label: 'Hover surface', group: 'foundations', fallback: '#1c2023',
    effect: 'The neutral step up a row or menu item takes when the pointer is over it.',
  },

  // ── Typography ────────────────────────────────────────────────────────────────────────────────
  {
    key: 'cleanWhite', css: '--clean-white', label: 'Primary text', group: 'typography', fallback: '#f5f7f8',
    effect: 'Body copy, headings and every identity on a dark surface.',
    cascadesTo: ['--foreground', '--card-foreground', '--text-primary', '--nav-foreground', '--bracket-text'],
  },
  {
    key: 'mutedText', css: '--muted-text', label: 'Secondary text', group: 'typography', fallback: '#9ca6ad',
    effect: 'Supporting copy: excerpts, captions, the second line of an identity.',
    cascadesTo: ['--muted-foreground', '--text-secondary', '--loss'],
  },
  {
    key: 'steel', css: '--steel', label: 'Muted text', group: 'typography', fallback: '#7d8a94',
    effect: 'The quietest readable text — dates, metadata, supporting arithmetic on a plaque.',
    cascadesTo: ['--text-muted'],
  },
  {
    key: 'steelBright', css: '--steel-bright', label: 'Label text', group: 'typography', fallback: '#a3aeb6',
    effect: 'Letterspaced uppercase labels and eyebrows, and inactive navigation items.',
    cascadesTo: ['--nav-inactive'],
  },
  {
    key: 'textOnMedia', css: '--text-on-media', label: 'Text on photography', group: 'typography', fallback: '#ffffff',
    effect: 'Copy laid over a photograph, which needs to be brighter than text on a flat ground.',
  },
  {
    key: 'playerName', css: '--player-name', label: 'Player identity', group: 'typography', fallback: '#13d8e8',
    effect: 'The CueVerse ID wherever it links to a profile. Interactive, so it reads as a link.',
  },

  // ── Borders & depth ───────────────────────────────────────────────────────────────────────────
  {
    key: 'line', css: '--line', label: 'Subtle border', group: 'borders', fallback: '#232b31',
    effect: 'Table rules, input edges and the quiet division inside a panel.',
    cascadesTo: ['--border', '--input', '--bracket-outline', '--bracket-divider'],
  },
  {
    key: 'lineStrong', css: '--line-strong', label: 'Strong border', group: 'borders', fallback: '#33404a',
    effect: 'The edge of a panel, and the connectors in a bracket.',
  },
  {
    key: 'steelDim', css: '--steel-dim', label: 'Divider', group: 'borders', fallback: '#46525a',
    effect: 'Hairlines and grid marks. Never used for text — it is below the readable threshold by design.',
  },
  {
    key: 'ring', css: '--ring', label: 'Focus ring', group: 'borders', fallback: '#13d8e8',
    effect: 'The outline around whatever the keyboard is on. It has to stand out from every surface it can land on.',
  },

  // ── Brand accents ─────────────────────────────────────────────────────────────────────────────
  {
    key: 'signal', css: '--hot-red', label: 'Accent (marks)', group: 'brand', fallback: '#ff2a2a',
    effect: 'The accent as a MARK: rank one, live dots, record labels, thin rules, the active page. Text-sized, on dark.',
    cascadesTo: ['--signal', '--destructive', '--line-tech', '--nav-border', '--nav-active', '--streak-cold'],
  },
  {
    key: 'signalFill', css: '--signal-fill', label: 'Accent (filled)', group: 'brand', fallback: '#e01021',
    effect: 'The accent as a SURFACE: the one filled button on a page. Darker than the mark, because it carries white text.',
    cascadesTo: ['--primary', '--brand'],
  },
  {
    key: 'signalInk', css: '--signal-ink', label: 'Text on accent', group: 'brand', fallback: '#ffffff',
    effect: 'The only ink permitted on a filled accent surface.',
    cascadesTo: ['--primary-foreground', '--brand-foreground'],
  },
  {
    key: 'gold', css: '--champ-gold', label: 'Championship gold', group: 'brand', fallback: '#e9b949',
    effect: 'Championships and achievements only — crowns, trophies, medallions, winning results.',
    cascadesTo: ['--gold', '--win', '--bracket-winner'],
  },
  {
    key: 'success', css: '--success', label: 'Success', group: 'brand', fallback: '#35d07f',
    effect: 'Confirmations, and a winning run.',
    cascadesTo: ['--streak-hot'],
  },
  { key: 'warning', css: '--warning', label: 'Warning', group: 'brand', fallback: '#ffb02e', effect: 'Cautions, and results flagged for review.' },
  { key: 'info', css: '--cyan', label: 'Information', group: 'brand', fallback: '#13d8e8', effect: 'Links, data and online state.' },

  // ── Navigation ────────────────────────────────────────────────────────────────────────────────
  { key: 'navBg', css: '--nav-bg', label: 'Header surface', group: 'navigation', fallback: '#050607', effect: 'The bar across the top of every page.' },
  { key: 'navForeground', css: '--nav-foreground', label: 'Header text', group: 'navigation', fallback: '#f5f7f8', effect: 'The wordmark and the account menu.' },
  { key: 'navActive', css: '--nav-active', label: 'Current page', group: 'navigation', fallback: '#ff2a2a', effect: 'The navigation item for the page you are on, and its underline.' },
  { key: 'navInactive', css: '--nav-inactive', label: 'Other pages', group: 'navigation', fallback: '#a3aeb6', effect: 'Every navigation item that is not the current page.' },
  { key: 'navBorder', css: '--nav-border', label: 'Header rule', group: 'navigation', fallback: '#ff2a2a', effect: 'The line under the header, and above the footer.' },

  // ── Buttons & forms ───────────────────────────────────────────────────────────────────────────
  { key: 'primary', css: '--primary', label: 'Primary button', group: 'controls', fallback: '#e01021', effect: 'The filled action on a page: Rankings, Read The Break.' },
  { key: 'primaryInk', css: '--primary-foreground', label: 'Primary button text', group: 'controls', fallback: '#ffffff', effect: 'The label on a filled action.' },
  { key: 'primaryHover', css: '--primary-hover', label: 'Primary button, hovered', group: 'controls', fallback: '#c21f1f', effect: 'What a filled action becomes under the pointer.' },
  { key: 'input', css: '--input', label: 'Input border', group: 'controls', fallback: '#232b31', effect: 'The edge of a search field, a select or a text box.' },
  { key: 'secondary', css: '--secondary', label: 'Secondary surface', group: 'controls', fallback: '#14191d', effect: 'Outline buttons, chips and quiet controls.' },
  { key: 'secondaryInk', css: '--secondary-foreground', label: 'Secondary text', group: 'controls', fallback: '#f5f7f8', effect: 'The label on a quiet control.' },

  // ── Tables & rankings ─────────────────────────────────────────────────────────────────────────
  { key: 'card', css: '--card', label: 'Table header & rows', group: 'tables', fallback: '#14191d', effect: 'The sticky header of a ranking table, and a hovered row.' },
  { key: 'cardInk', css: '--card-foreground', label: 'Table text', group: 'tables', fallback: '#f5f7f8', effect: 'Values inside a table.' },
  {
    key: 'acid', css: '--acid', label: 'Filter bar surface', group: 'tables', fallback: '#f5f4f1',
    effect: 'The structural surface behind filter bars and season controls. It carries black text by rule.',
    cascadesTo: ['--acid-hover', '--acid-dim'],
  },
  { key: 'acidInk', css: '--acid-ink', label: 'Filter bar text', group: 'tables', fallback: '#050607', effect: 'The only ink permitted on the filter bar surface.' },

  // ── Seasons, tournaments & brackets ───────────────────────────────────────────────────────────
  { key: 'bracketSurface', css: '--bracket-surface', label: 'Bracket node', group: 'competition', fallback: '#14191d', effect: 'A matchup card in a playoff tree.' },
  { key: 'bracketConnector', css: '--bracket-connector', label: 'Bracket connector', group: 'competition', fallback: '#33404a', effect: 'The lines joining rounds, for paths that have not resolved.' },
  { key: 'bracketWinner', css: '--bracket-winner', label: 'Advancing side', group: 'competition', fallback: '#e9b949', effect: 'The winning identity, its score, and the path it advances along.' },
  { key: 'bracketMuted', css: '--bracket-text-muted', label: 'Undecided text', group: 'competition', fallback: '#6b767d', effect: 'TBD, byes and unplayed matches.' },

  // ── Articles & achievements ───────────────────────────────────────────────────────────────────
  { key: 'plaqueInk', css: '--text-primary', label: 'Plaque heading', group: 'editorial', fallback: '#f5f7f8', effect: 'Achievement titles, article headlines and panel headings.' },
  { key: 'plaqueMuted', css: '--text-muted', label: 'Plaque supporting text', group: 'editorial', fallback: '#7d8a94', effect: 'The line under an achievement figure, and article dates.' },

  // ── Homepage modules ──────────────────────────────────────────────────────────────────────────
  { key: 'heroInk', css: '--text-on-media', label: 'Hero text', group: 'homepage', fallback: '#ffffff', effect: 'The heading, champion name and rating laid over the hero photograph.' },
  { key: 'railRule', css: '--steel-dim', label: 'Rail dividers', group: 'homepage', fallback: '#46525a', effect: 'The angled cuts between entries in the top-five rail.' },

  // ── Footer & status ───────────────────────────────────────────────────────────────────────────
  { key: 'statsBar', css: '--surface-inset', label: 'Statistics bar', group: 'footer', fallback: '#080b0d', effect: 'The thin totals bar at the foot of the homepage.' },
  { key: 'footerBg', css: '--footer-bg', label: 'Footer surface', group: 'footer', fallback: '#0b0f12', effect: 'The footer behind the legal line and the site links.' },

  // ── Image treatments ──────────────────────────────────────────────────────────────────────────
  {
    key: 'scrim', css: '--scrim-tint', label: 'Photograph tint', group: 'imagery', fallback: '#050607',
    effect: 'The colour photography is darkened WITH. It never changes what the photograph contains.',
  },
]

/** Lookup by the key stored in settings. */
export const TOKEN_BY_KEY = new Map(THEME_TOKEN_REGISTRY.map((t) => [t.key, t]))

/** Every custom property this system is allowed to write. Used to reject anything else. */
export const WRITABLE_CSS_VARS = new Set(THEME_TOKEN_REGISTRY.map((t) => t.css))
