# WCC — Frontend Shell

Production-quality public frontend shell: the visual identity every future page
inherits. **Premium esports aesthetic** — dark-first, gold accent, minimal,
typographic, fast, no heavy animation.

> **Season 2 launch:** the public site is now the home of **WCC Season 2** —
> registration, an upcoming group stage, a future playoff bracket, the completed
> Season 1 archive, plus public accounts and competition registration. See
> **`SEASON2_LAUNCH.md`** for nav, routes, accounts, the Season 2 state model, and
> remaining launch work. The launch pages (`/`, `/groups`, `/playoffs`, `/seasons`,
> `/register`, `/login`, `/account`, `/rules`) show **real, honest state** (no
> fabricated data). The **historical archive** routes (`/players`,
> `/competitions`, `/rankings`, `/hall-of-fame`, `/news`) still render **temporary
> sample data** (`src/lib/mock-data.ts`) and carry an archive-scoped "sample data"
> banner + per-section "Sample" badges. Swapping mock data for Prisma queries will
> not require redesigning the UI.

## Theme architecture

- **Tokens** live as CSS custom properties in `src/app/(frontend)/globals.css`.
  Dark is the **default** (values in `:root`); the optional light theme overrides
  them under `.light`. Tokens are mapped to Tailwind color utilities via
  `@theme inline` (`--color-background`, `--color-primary` = gold, `--color-gold`,
  `--color-success`, etc.), so `bg-background`, `text-gold`, `border-gold/40`, etc.
  all resolve from the token layer.
- **No-flash theming:** a tiny inline script in the layout adds `.light` before
  paint when the user has chosen it; default (no class) = dark, so there's no flash.
  `ThemeToggle` (client) flips the class and persists to `localStorage`.
- **Typography:** `next/font` — Space Grotesk (display/headings), Inter (body/UI),
  JetBrains Mono (stats/tables, via the `.tabular` helper). Exposed as
  `--font-display` / `--font-sans` / `--font-mono` and wired into `@theme`.
- **Accent:** a single gold hue (`--gold`) with `--gold-soft` / `--gold-dim` for
  gradients (`.text-gold-gradient`) and glows. Utilities: `.bg-grid` (faint grid),
  `.eyebrow` (mono uppercase label).
- **Palette:** near-black cool-neutral background, layered card surfaces, subtle
  borders, gold primary, semantic `success` / `destructive` / `warning`.

## Frontend folder structure

```
src/
├─ app/(frontend)/
│  ├─ layout.tsx            # fonts, theme no-flash script, header/main/footer, preview banner
│  ├─ globals.css           # theme tokens (dark + light), @theme mapping, base + helpers
│  ├─ page.tsx              # Home
│  ├─ seasons/page.tsx
│  ├─ seasons/[slug]/page.tsx  # season detail (SSG; dynamicParams=false → 404 for unknown)
│  ├─ competitions/page.tsx
│  ├─ competitions/[slug]/page.tsx  # competition detail (SSG; dynamicParams=false → 404)
│  ├─ rankings/page.tsx
│  ├─ players/page.tsx
│  ├─ players/[slug]/page.tsx   # player detail (SSG; dynamicParams=false → 404 for unknown)
│  ├─ hall-of-fame/page.tsx
│  ├─ news/page.tsx
│  ├─ news/[slug]/page.tsx       # minimal news detail (SSG; dynamicParams=false → 404)
│  ├─ rules/page.tsx
│  ├─ search/page.tsx            # public search results (dynamic; reads ?q=)
│  ├─ not-found.tsx         # 404
│  ├─ error.tsx             # error boundary (client)
│  └─ loading.tsx           # route-level loading skeleton
├─ components/
│  ├─ ui/                   # primitives: button, badge, card, table, input,
│  │                        #   skeleton, breadcrumb, empty-state, container
│  ├─ site-header.tsx       # sticky header
│  ├─ site-footer.tsx       # footer
│  ├─ main-nav.tsx          # desktop nav (active states) [client]
│  ├─ mobile-nav.tsx        # mobile drawer [client]
│  ├─ search-bar.tsx        # global search field [client]
│  ├─ theme-toggle.tsx      # dark/light toggle [client]
│  ├─ preview-notice.tsx    # site-wide "sample data" banner
│  ├─ brand.tsx             # WCC logo/wordmark
│  ├─ hero-banner.tsx       # reusable hero frame
│  ├─ section-header.tsx    # section eyebrow/title/action/sample marker
│  ├─ page-header.tsx       # inner-page header band (breadcrumbs + title)
│  ├─ stat-card.tsx         # KPI tile
│  ├─ status-badge.tsx      # competition/season status pill
│  ├─ season-card.tsx · player-card.tsx · news-card.tsx · competition-card.tsx
│  ├─ ranking-table.tsx
│  ├─ historical-note.tsx   # restrained reusable historical/admin annotation
│  ├─ section-nav.tsx       # generic in-page anchor section nav
│  ├─ confidence-badge.tsx  # archive confidence pill (explicit/verified/…/unknown)
│  ├─ title-leaders.tsx     # historical title leaders table (real archive data)
│  ├─ search/               # search-result-card.tsx
│  ├─ competition/          # competition-detail components (new):
│  │  ├─ competition-hero.tsx · competition-summary.tsx
│  │  ├─ participant-list.tsx · stage-overview.tsx · champion-panel.tsx
│  ├─ season/               # season-detail components:
│  │  ├─ season-summary.tsx · season-section-nav.tsx (anchor sub-nav)
│  │  ├─ group-card.tsx · standings-table.tsx
│  │  ├─ match-list.tsx · match-row.tsx
│  │  ├─ playoff-bracket-shell.tsx · source-list.tsx
│  └─ player/               # player-detail components:
│     ├─ player-hero.tsx · alias-list.tsx · career-stats.tsx
│     ├─ championship-history.tsx · competition-history.tsx
│     ├─ match-history.tsx · ranking-history.tsx
│     ├─ hall-of-fame-panel.tsx · source-panel.tsx · historical-notes.tsx
└─ lib/
   ├─ nav.ts                # PRIMARY_NAV (single source for header/footer/mobile)
   ├─ mock-data.ts          # TEMPORARY typed sample data (mirrors future Prisma shapes)
   ├─ preview-players.ts    # player preview data loader (typed) + getPlayerPreview/Index
   ├─ preview-competitions.ts  # competition preview loader + getCompetitionPreview/Index
   ├─ preview-stats.ts      # real archive totals (players/aliases/matches/seasons)
   ├─ search.ts             # searchAll() over all preview datasets (normalized substring)
   ├─ preview-data/         # archive-players.json + archive-competitions.json + archive-stats.json
   ├─ format.ts             # date / percent / archive-season formatting (deterministic)
   └─ utils.ts              # cn()
```

## Reusable components created

**Primitives (`components/ui/`):** `Button` (adds `xl` size), `Badge` (gold/solid/
outline/muted/success/destructive), `Card` (+Header/Title/Description/Content/
Footer), `Table` (+Header/Body/Row/Head/Cell), `Input`, `Skeleton`, `Breadcrumbs`,
`EmptyState`, `Container`.

**Composite (`components/`):** `SiteHeader`, `SiteFooter`, `MainNav`, `MobileNav`,
`SearchBar`, `ThemeToggle`, `PreviewNotice`, `Logo`, `HeroBanner`, `SectionHeader`,
`PageHeader`, `StatCard`, `StatusBadge`, `SeasonCard`, `PlayerCard`, `NewsCard`,
`CompetitionCard`, `RankingTable`, `HistoricalNote`.

**Season detail (`components/season/`):** `SeasonSummary`, `SeasonSectionNav`
(anchor sub-nav), `GroupCard`, `StandingsTable`, `MatchList`, `MatchRow`,
`PlayoffBracketShell`, `SourceList`.

**Player detail (`components/player/`):** `PlayerHero`, `AliasList`, `CareerStats`,
`ChampionshipHistory`, `CompetitionHistory`, `MatchHistory`, `RankingHistory`,
`HallOfFamePanel`, `SourcePanel`, `HistoricalNotes` — plus the generic
`SectionNav` (`components/section-nav.tsx`).

**Competition detail — new (`components/competition/`):** `CompetitionHero`,
`CompetitionSummary`, `ParticipantList`, `StageOverview`, `ChampionPanel`, plus the
generic `ConfidenceBadge` (`components/confidence-badge.tsx`).
**Reused (no duplication):** `GroupCard`, `StandingsTable`, `MatchList`/`MatchRow`,
`PlayoffBracketShell`, `SourceList` (from `components/season/`), `HistoricalNote`,
`SectionNav`, `SectionHeader`, `StatusBadge`.

## Player detail route (`/players/[slug]`)

- **Route:** SSG via `generateStaticParams()` over the preview player slugs, with
  `dynamicParams = false` → unknown slugs return a real **404**. `generateMetadata()`
  sets a per-player title/description. `PlayerCard` (on `/players`) links here.
- **Sections** (generic `SectionNav` anchors): Overview (aliases + historical notes),
  Career, Championships, Competitions, Match Record, Rankings, Hall of Fame, Sources.
- **Identity-first design:** `PlayerHero` shows the primary alias, canonical id
  (`P####`), region, activity years, and an **"Archive preview · pending verification"**
  badge; `AliasList` renders all known aliases (marking the primary); championship
  rows carry a **confidence** badge (explicit/heuristic/reconstructed);
  `HistoricalNotes` surfaces archive identity notes (e.g. the P1316 merge). This
  layout already supports multiple aliases, verified/unverified states, identity
  confidence, historical annotations, and future account linking (presentation only —
  no claiming/editing).

### Preview-data strategy

Unlike earlier phases, player pages use **real WCC archive data as preview
content** (to make the site feel authentic pre-import) — never fabricated. A curated
snapshot of ~10 players was extracted (read-only) from what was then
`Documents\Cueverse Prime\archive_viewer` (that folder was deleted 2026-08-16; the viewer now lives at
`C:\Claude\Archive Viewer`) into
`src/lib/preview-data/archive-players.json`, loaded via typed helpers in
`src/lib/preview-players.ts` (`getPlayerPreview`, `getPlayerPreviewSlugs`,
`getPlayerIndex`). Shapes mirror the future Prisma models (Player, PlayerAlias,
Championship, PlayerSeasonStat, PlayerCareerStat, HeadToHead, HallOfFameEntry).
**Nothing is invented:** where the archive lacks data (e.g. time-series rankings,
full per-match logs), the UI shows honest pending states. Archive seasons are
labelled historical and are **not** presented as WCC seasons. This is preview
content only — **not** a Prisma connection or the import pipeline.

`SeasonCard` → `/seasons/[slug]`, `PlayerCard` → `/players/[slug]`, and
`CompetitionCard` → `/competitions/[slug]` are all **built**. Only `NewsCard`
(`/news/[slug]`) still links to an unbuilt detail route — see Remaining work.

## Season detail route (`/seasons/[slug]`)

- **Route:** SSG via `generateStaticParams()` over the mock season slugs, with
  `export const dynamicParams = false` so any unknown slug returns a real **404**
  (styled not-found page). `generateMetadata()` sets a per-season title/description.
- **Sections** (in-page anchor nav, all server-rendered): Overview, Groups,
  Standings, Schedule & Results, Playoffs, Rules, Sources.
- **Two data states** (`DataState` in mock-data): `'pending'` shows honest empty
  states ("Group assignments pending source verification", "Results not yet
  imported", "Champion pending verification", "Official playoff bracket pending
  source verification", "Source review pending"); `'sample'` shows neutral
  synthetic placeholders only (Player A–H, Qualifier 1–4, Seed pending) to exercise
  the components. **WCC Season 1 (`ego-season-1`) uses `'pending'`** — no invented
  players, scores, seeds, dates, or champion.
- **Historical note:** the `HistoricalNote` component (muted gold-bordered, non-
  sensationalized) renders the temporary seeding-review wording in the Overview
  section for WCC Season 1 (text in `EGO_S1_HISTORICAL_NOTE`).
- **Bracket:** `PlayoffBracketShell` is a responsive shell (horizontally scrollable
  round columns; supports TBD/bye/walkover/forfeit/pending + missing scores) — not
  a bracket engine. WCC Season 1 shows the pending state.

### Mock-data shape (season detail)

`getSeasonDetail(slug): SeasonDetail | undefined` returns:
`SeasonDetail { slug, name, originalName?, year, status, dataState, startDate|null,
endDate|null, formatSummary|null, participants|null, divisions, currentPhase,
champion { handle|null, state }, historicalNote?, groups: GroupData[], playoff:
PlayoffData, rulesRef|null, sources: SeasonSourceRef[] }` where `GroupData` holds
`roster`, `standings: StandingRowData[]`, `matches: MatchData[]`; `PlayoffData` has
`state, format, rounds: BracketRoundData[]`. Shapes mirror the future
Competition → Stage → Group/Bracket → Standing/Match/Seed/Championship model.

## Competition detail route (`/competitions/[slug]`)

- **Route:** SSG via `generateStaticParams()` over the curated archive competition
  slugs, `dynamicParams = false` → unknown slugs return a real **404**.
  `generateMetadata()` sets a per-competition title/description. The `/competitions`
  index cards (archive section) link here.
- **Sections** (generic `SectionNav`): Overview (summary + historical notes),
  Participants, Stages, Groups, Standings, Schedule & Results, Playoffs, Champion,
  Sources.
- **Supports all types/states:** the structure handles Seasons, Cups, Tournaments,
  Invitationals and active/completed/cancelled statuses; each competition owns an
  ordered `stages[]` so formats are not assumed uniform. (The archive only contains
  single-elimination league seasons, so the three previews are historical seasons —
  no cups/tournaments are fabricated.)
- **Reuse:** groups/standings/schedule/playoffs render through the existing season
  components (`GroupCard`, `StandingsTable`, `MatchList`, `PlayoffBracketShell`,
  `SourceList`) because the preview data uses the same `GroupData`/`PlayoffData`/
  `SeasonSourceRef` shapes.

### Archive confidence presentation

`ConfidenceBadge` renders the archive confidence level everywhere uncertainty
exists — `ConfidenceLevel = explicit | verified | reconstructed | heuristic |
incomplete | disputed | unknown`. Shown on the hero (record confidence), the
summary, each stage (`StageOverview`), and the champion (`ChampionPanel` marks
**inferred** champions). Honest states are never hidden: "Format pending
verification", "Participant list incomplete", "results partially reconstructed",
"Champion pending / inferred", "Source review pending", and a records note that
playoff match results were not recorded in the archive (only seedings survive). The
Schedule section discloses how many of the recorded group matches are shown
("Showing X of Y…"). Archive competitions carry an **"Archive preview · pending
verification"** + **"Historical archive"** badge and are never labelled WCC seasons.

### Competition preview-data shape

`getCompetitionPreview(slug): CompetitionPreview | undefined`, `getCompetitionPreviewSlugs()`,
and `getArchiveCompetitionIndex(): Competition[]` load
`src/lib/preview-data/archive-competitions.json` (curated read-only WCC snapshot).
`CompetitionPreview { slug, competitionId, seasonId, division, name, legacyName,
type, chronology: 'archive'|'ego', status, year|null, dateLabel|null, datesPending,
organizer, formatSummary|null, participantsCount|null, confidence: ConfidenceLevel,
champion: { name, slug|null, confidence, inferred }|null, runnerUp|null, participants:
string[], stages: StageInfo[], groups: GroupData[], totalGroupMatches,
shownGroupMatches, playoff: PlayoffData, sources: SeasonSourceRef[],
historicalNotes: string[] }`.

## Homepage preview-data wiring

The homepage keeps its layout but now uses **real local archive preview data** with
honest states — no fabricated events, results, rankings, or stats:

- **Archive stats strip** — real WCC totals from `getArchiveStats()`
  (players/aliases/matches/seasons), labelled "From the WCC archive · preview".
- **Featured Season** — `getSeasonDetail('ego-season-1')` in its honest pending state
  (participants/champion/records pending); links to `/seasons/ego-season-1`.
- **Historical Title Leaders** — `TitleLeaders` (real archive championship counts);
  clearly not a current ranking ("official WCC rankings pending"); links to
  `/players/[slug]`.
- **Recent Results** — honest empty ("Recent results pending match-data import").
- **Upcoming Competitions** — honest empty ("No active competition announced").
- **Historical Spotlight** — one real archive competition (`2005-season-2`) with a
  confidence badge; links to `/competitions/[slug]`. Labelled "Historical archive",
  never an WCC season.
- **Player Spotlight** — the top real archive player; links to `/players/[slug]`.
- **Latest News** — preview news; links resolve to `/news/[slug]`.
- **CTA** — honest ("Explore the archive" → `/players` / `/competitions`); the old
  fabricated "Season 5 registration" was removed.

Every homepage link resolves (verified). `/rankings` was likewise switched from the
synthetic ranking table (dead player links) to `TitleLeaders` + an "WCC rankings
pending" note.

## Search (`/search`)

- **Route:** dynamic server route reading `?q=`. `SearchBar` is a **native GET form**
  (`action="/search"`) — Enter/submit works with **no client JavaScript**; the query
  prefills via `defaultValue` on the results page. Works on desktop and mobile
  (same component in header + mobile drawer) and is accessible (labelled `role="search"`).
- **Indexing strategy:** `searchAll(q)` in `src/lib/search.ts` runs a straightforward
  **normalized, case-insensitive substring** match over the current preview datasets —
  players (+aliases), archive competitions, WCC season previews, and news. No fuzzy-
  search library (unnecessary at this scale).
- **Alias matching:** `searchPlayers` matches primary names AND aliases; an alias hit
  **returns the canonical player** and reports the matched alias ("matched alias: …").
- **Results:** grouped by type (Players · Competitions · Seasons · News); each row shows
  title, subtitle, a type badge, matched alias (when applicable), an archive-preview /
  pending / WCC status badge, and a link to the correct detail page.
- **States:** empty query → "Enter a player, alias, season, or competition"; no results
  → "No matching records found"; single/multiple/grouped results; alias and partial
  matches all supported. Result links verified to resolve.

## Honest empty-state / labeling rules

- Missing data shows honest text, never fabricated content: "pending match-data import",
  "No active competition announced", "Champion pending verification", "official WCC
  rankings pending", "Archive preview · pending verification".
- Historical archive competitions are **never** labelled WCC seasons; the historical
  title leaderboard is **never** labelled a current WCC ranking.

## Pages built

Home, Seasons, **Season detail (`/seasons/[slug]`)**, Competitions, **Competition
detail (`/competitions/[slug]`)**, Rankings, Players, **Player detail
(`/players/[slug]`)**, Hall of Fame, News, **News detail (`/news/[slug]`)**, Rules,
**Search (`/search`)** — plus 404, error, and loading states. All are **server
components** except the few interactive pieces marked `[client]` above. Every card
link across the site now resolves (no broken preview routes).

## How to preview locally

From the project root (`C:\Claude\8BR`), the launcher starts the contained database and then the site:

```powershell
.\dev.ps1
```

Or run the two steps separately:

```powershell
.\scripts\db\db-start.ps1
```
```bash
npm run dev
```

Then open **http://localhost:3000**. (The DB isn't required to render these pages,
but `npm run dev` boots the whole app including Payload, which expects the DB.)
Refresh after each change — the pages hot-reload.

## Remaining frontend work

- Deferred/broken routes: **none** — every card and homepage/search link resolves.
  `/news/[slug]` is a minimal preview detail (excerpt + "full article pending").
- Competition detail before DB: real playoff bracket rendering (results/progression)
  when verified match data exists; full group match logs (currently capped, with an
  honest "showing X of Y" note); expand the curated set / add real WCC competitions.
- Player detail before DB: full per-match history logs and time-series ranking
  history (both currently honest pending states), and alias-usage-by-competition.
- Search before DB: broaden the index beyond the ~10 curated preview players /
  3 competitions once real data is loaded; optional result pagination.
- Season detail before DB integration: real bracket rendering engine (single/
  double elim, grand-final reset, seeding).
- Switch `/seasons/[slug]`, `/players/[slug]`, `/competitions/[slug]` to
  `dynamicParams=true` + `notFound()` once backed by the database (now `false`).
- Replace `src/lib/mock-data.ts`, `preview-players.ts`, `preview-competitions.ts`
  with Prisma-backed loaders — components are typed to the same shapes, so no UI
  redesign expected.
- Real News/Rules content from Payload; remove the `PreviewNotice` banner and
  "Sample"/"Pending" markers once live data is in.
- Optional: scrollspy/active state on the season section nav; pagination/filtering
  on Players & Competitions.

## Guardrails honored

Frontend shell only — no database integration, no archive import, no homepage
"real facts", no fabricated records. Temporary content is clearly labelled.


## Launch polish pass (Season 2)

A UI-refinement pass over the public site — no new features, no identity redesign;
tightened hierarchy, consistency, responsiveness, a11y, and SEO.

### Pages improved
- **Home** — hero eyebrow now carries a live "Registration Open" status dot;
  Register is the primary CTA, Sign In secondary, Season 1 a clearly-secondary
  inline link; consistent section rhythm.
- **Groups / Playoffs** — replaced bare empty states with `StageComingSoon`: an
  intentional pre-stage panel (icon, status, headline, 3-step process, CTAs,
  cross-links). No fake brackets or placeholder teams.
- **Seasons** — Current (Season 2, active) vs Completed (Season 1 archive) kept
  visually distinct.
- **Register** — reads as entering a real competition: lead-in copy, `Detail`
  definition list, and the action card ordered first on mobile (`order-*`).
- **Login** — vertically-centred card with its own `h1` ("Welcome back").
- **Account** — registration status card is colour-cued (gold when eligible, success
  when registered) and ordered first on mobile.
- **Rules** — proper document layout: sticky desktop table-of-contents + mobile
  `SectionNav`, numbered anchored `<section>`s with `scroll-mt` offset.

### Design conventions (standardized)
- **Spacing:** `Container` (`max-w-6xl`, `px-4 sm:px-6 lg:px-8`) on every section;
  section vertical rhythm `py-12`/`py-16`, compact strips `py-8`.
- **Radius:** token `--radius: 0.5rem`; cards `rounded-lg`, hero/feature panels
  `rounded-2xl`, pills `rounded-full`.
- **Type:** Space Grotesk display headings with a single `h1` per page and no level
  skips; `.eyebrow` mono label; `.tabular` for numerics.
- **Color:** gold = primary/active, `success` = registered/live, `muted` = pending.
- **Badges:** `gold` (open/active), `success` (registered), `muted` (pending/closed).
- **Buttons:** `default` = primary action, `outline` = secondary, `ghost` = tertiary/
  inline; `xl` in heroes, `lg` on forms/panels.

### Reusable UI patterns
- `StageComingSoon` (`components/stage-coming-soon.tsx`) — deliberate pre-stage state
  for any competition stage with no data yet.
- `SectionNav` (`components/section-nav.tsx`) — generic in-page anchor nav (reused by
  Rules + season detail).
- `pageMetadata()` / `absoluteUrl()` (`lib/site.ts`) — one helper for per-page
  canonical + OpenGraph + Twitter metadata.

### Accessibility
- One `h1` per page verified across all launch routes; heading levels don't skip
  (card titles are `div`s, not headings).
- Mobile nav closes on Escape and locks body scroll while open; nav landmarks are
  labelled (`Primary`, `Compete`, `Account`, `Archive`).
- Global `:focus-visible` ring retained; theme tokens unchanged (contrast preserved).
- Form fields have associated `<label>`s + hint text; errors use `role="alert"`.

### Performance
- `getCurrentUser()` wrapped in React `cache()` so the header + page share one
  `payload.auth` per request instead of authenticating twice.
- No unnecessary `'use client'`: only nav (pathname/state), theme toggle, account
  forms (`useActionState`/`useFormStatus`), and the pathname-scoped preview banner
  are client; `SearchBar` and all content are server components.

### SEO
- Root layout: `metadataBase` (from `NEXT_PUBLIC_SITE_URL`), default OpenGraph +
  Twitter, `themeColor` viewport; **no** default canonical (each page self-canonicals
  so nothing masquerades as a duplicate of `/`).
- Per-page canonical + OG + Twitter via `pageMetadata()` on every public route;
  `/account`, `/login`, `/search` are `noindex`.
- Added `app/robots.ts` (+ disallows account/login/admin/archive-review/api/search)
  and `app/sitemap.ts` (public indexable routes).

### Responsiveness
Verified at 320/375/768/1024/1440 — no horizontal scroll, cards reflow, no clipped
buttons; forms and coming-soon panels stack cleanly on mobile.

### Remaining visual work before launch
- Add a real OpenGraph/Twitter share image (currently text-only cards) and set
  `NEXT_PUBLIC_SITE_URL` to the production domain so canonical/OG/sitemap resolve.
- Archive detail routes (`/competitions/[slug]`, `/players/[slug]`, `/news/[slug]`)
  still inherit minimal metadata — add self-canonicals when those move to real data.
- Optional: scrollspy active-state on the Rules/season anchor navs.

## Competition Administration System

Staff-only tooling to operate a season end-to-end (registration → groups → matches
→ standings → playoffs) lives at **`/staff`** and is documented in
**`COMPETITION_ADMIN.md`**. It is backed by the live Prisma competition models
(`comp_*` tables) and a pure deterministic engine in `src/lib/competition/`
(seeded group draw, round-robin, standings, single-elimination bracket, score
validation). The public `/groups`, `/playoffs`, `/seasons`, `/`, `/register`,
`/account` pages consume the **published** output of that system — one source of
truth, honest pending states until data is published. The old hardcoded
`lib/season2.ts` and the Payload `Registrations` collection were retired in favour
of Prisma `Season` / `Registration`.
