# EGO — Elite Gamers Only · PROJECT PLAN

**EGO — Elite Gamers Only**
<sub>formerly known as 8BRCAM</sub>

> Status: **APPROVED ARCHITECTURE — initialization in progress.**
> Stack approved by owner: TypeScript · Next.js (App Router) · PostgreSQL · Payload CMS 3 (embedded) · Tailwind CSS · shadcn/ui.
> All work confined to `C:\Users\Cerebro\Documents\8BR`. Updated 2026-07-29 to reflect confirmed brand, competition model, navigation, and homepage direction.

---

## 0. Environment snapshot (verified)

| Item | Result |
|---|---|
| Working folder | `C:\Users\Cerebro\Documents\8BR` (no nested EGO folder) |
| Node.js | v24.18.0 |
| npm | 11.16.0 |
| Git | 2.55.0.windows.2 |
| Python | 3.12.10 |
| Local Postgres | `pgserver` 0.1.4 (bundled **PostgreSQL 16.2**) — no Docker on this machine |
| OS / Shell | Windows 11 Pro 26200 · PowerShell 5.1 |

Local DB for dev/build runs from pgserver's bundled binaries on fixed port **54329**, `trust` auth, database `ego` → `DATABASE_URI=postgresql://postgres@127.0.0.1:54329/ego`.

---

## 1. Brand

- **Primary title:** `EGO`
- **Full name:** `Elite Gamers Only`
- **Legacy line:** `formerly known as 8BRCAM` — treated as **secondary legacy text**, never part of the primary logo or main title.
- The term **"Prime" is retired.** It must not appear in architecture, navigation, database terminology, UI labels, sample content, components, or route names. It survives only inside untouched historical **source records** that literally used it, and in the existing on-disk source-data path (`Documents\Cueverse Prime\...`), which is a legacy folder name we do not rename.
- Visual identity is **not finalized.** The black-and-gold reference is a structural/stylistic direction, **not** approved final branding. Colors, logo, typography, and domain remain open.
- Desired feel: **premium, competitive, modern, authoritative, data-driven**, and closely tied to online pool competition.

---

## 2. Project purpose

EGO is the competitive organization and historical home for CueVerse online pool competition. It serves:

1. **Fans & competitors** — a premium public site centered on live competition and a deep historical archive.
2. **Administrators** — an audit-friendly back office to manage every competition entity and to correct historical records traceably, with source references and an issue-reporting workflow.

The product is fundamentally a **records institution**: accuracy, alias→canonical identity resolution, and correction traceability are first-class requirements.

---

## 3. Competition structure (confirmed model)

Three competition categories, sharing a **common underlying competition model** where practical, each supporting type-specific rules, formats, stages, standings, and statistics:

| Category | Role |
|---|---|
| **Seasons** | The **primary** recurring EGO competition. |
| **Cups** | **Secondary** competitions; may use different formats. |
| **Tournaments** | Special events, invitationals, one-offs, or independently named events. |

**Modeling approach:** a shared `Competition` core (identity, type, dates, status, rules ref, provenance) with type discriminated by `competition_type ∈ {season, cup, tournament}`, plus shared substructure — **stages → groups / brackets → matches → results → standings** — and type-specific extensions where a category genuinely diverges. This avoids three parallel silos while allowing format-specific behavior.

---

## 4. Public navigation (planned)

Primary public areas:

`Home` · `Seasons` · `Cups` · `Tournaments` · `Standings` · `Players` · `History` · `Hall of Fame` · `Rules` · `News`

- **Registration** lives under the relevant competition, not as a permanent top-level item.
- **History** contains the legacy **8BRCAM archive** and must clearly distinguish **historical records** from **current EGO competitions** (see §7 provenance).

Planned route names (kebab-case, no "Prime"): `/`, `/seasons`, `/cups`, `/tournaments`, `/standings`, `/players`, `/history`, `/hall-of-fame`, `/rules`, `/news`.

---

## 5. Homepage direction (NOT being built yet)

The provided mockup sets **general direction only** — not to be reproduced pixel-for-pixel, and not built in this foundation phase. The homepage should eventually be a **competition dashboard**, not a marketing page. Likely content areas:

- EGO brand hero
- Current / featured season
- Upcoming events
- Top 10 all-time champions
- Current cup / competition standings
- Recent results
- News & announcements
- Player spotlight
- Quick links into historical records

Color scheme (black-and-gold) is **not locked in**.

---

## 6. Technology stack (approved)

| Layer | Choice | Role |
|---|---|---|
| Language | **TypeScript** | Type safety across UI and data. |
| Framework | **Next.js (App Router)** | Public site + server routes in one app. |
| Database | **PostgreSQL** | Relational integrity for competition records. |
| Admin / auth / versioning | **Payload CMS 3 (embedded)** | Auto admin UI, RBAC, auth, document versioning (audit trail) — mounted inside the same Next.js app. |
| Styling | **Tailwind CSS** | Premium look with minimal bespoke CSS. |
| UI primitives | **shadcn/ui** | Owned, themeable components. |

**Payload ↔ PostgreSQL division of responsibility (important):** Payload manages content/administrative entities where its collections + versioning + RBAC are a clean fit (Players, Aliases, News, Rules, Sources, Corrections, Issue Reports, Users, competition definitions). **Analytical / high-volume relational data** (matches, results, standings, head-to-head, per-season/career stats) is modeled for **relational fitness first** — we will not force large analytical tables into generic CMS collections where a dedicated relational model and computed/derived tables serve better. Payload and Postgres are designed to coexist on the **same database**; derived reporting tables are regenerated from primary data so corrections propagate.

---

## 7. Data & legacy archive strategy

**Source (reference only, never modified, never a production data source):**
`C:\Users\Cerebro\Documents\Cueverse Prime\archive_viewer\` — a mature, already-normalized CSV export (the read-only inspection tool stays untouched). It contains ~1,948 canonical players, 5,572 aliases already linked, 48 seasons, 94 season-divisions, 634 groups, 10,765 group matches, full playoffs/brackets, head-to-head, per-season & career stats, achievements, Hall of Fame, and a **corrections seed** (`player_merges.csv`, `player_splits.csv` with review notes/dates).

**Rules:**
- The EGO app **imports validated snapshots** into PostgreSQL; it never reads those CSVs as a live production source.
- **Preserve existing stable identifiers** where practical: players `P####`, seasons `YYYY-sN`, match/source IDs.
- **Aliases resolve to one canonical player identity.**
- **Traceability is mandatory:** source references, corrections, merges, splits, and disputes remain queryable and attributable (who/when/before/after).
- **Provenance flag:** every record is marked as **imported historical (8BRCAM legacy)** vs **native EGO** so the two are always distinguishable in data and UI. Confidence/provenance signals from the source (`champion_confidence`, `bracket_reconstructed`, `source_kind`) are carried through, not dropped.

---

## 8. Admin scope (future — Payload)

The admin system must eventually support: Players · Aliases · Seasons · Cups · Tournaments · Competition stages · Groups · Playoffs · Matches · Results · Standings · Rankings · Championships · Accomplishments · Hall of Fame entries · Rules · News · Source references · Corrections · Player merges & splits · User-submitted issue reports.

Authentication & RBAC via Payload. Roles (initial): `public`, `member`, `editor`, `admin`. Historical edits are **versioned** for audit.

---

## 9. Folder structure (target — production-oriented)

```
EGO/
├─ PROJECT_PLAN.md · ARCHITECTURE.md · README.md
├─ .env.example · .gitignore · package.json · tsconfig.json
├─ next.config.* · postcss.config.* · components.json
├─ src/
│  ├─ app/
│  │  ├─ (frontend)/           # public site: layout (header/footer), empty home, future areas
│  │  └─ (payload)/            # Payload admin (/admin) + Payload API (template-provided)
│  ├─ collections/             # Payload collections (Users, Media, + future entities)
│  ├─ components/              # presentational UI (no embedded records)
│  │  └─ ui/                   # shadcn/ui primitives
│  ├─ lib/                     # utils (cn), data access, exporters (future)
│  ├─ payload.config.ts
│  └─ payload-types.ts         # generated
├─ scripts/                    # import / verify pipelines (future)
└─ .pgdata/                    # local pgserver data dir (gitignored)
```

---

## 10. Development phases

- **Phase 0 — Foundation (current):** initialize app in place; TS + Next App Router + Payload 3 + Tailwind + shadcn foundation; env/gitignore/README/ARCHITECTURE; minimal shell (public layout, placeholder header/footer, empty home, Payload admin route); pass typecheck/lint/build; confirm it runs. **No homepage sections, no data, no fake records.**
- **Phase 1 — Data model & import:** relational + Payload schema for the shared competition model and identity/corrections; idempotent importer of validated snapshots preserving stable IDs; port integrity checks; provenance flags.
- **Phase 2 — Public archive (read-only):** Seasons/Cups/Tournaments, Standings, Players, History (8BRCAM archive), Hall of Fame, Rules, News; search/filter; CSV/JSON exports.
- **Phase 3 — Admin & corrections:** RBAC, versioned edits, corrections/sources, merges/splits, issue-report workflow.
- **Phase 4 — Accounts & live competition:** member accounts, per-competition registration, live season/cup/tournament operation.
- **Phase 5 — Design & launch:** premium visual pass once branding is decided, a11y, performance, mobile QA, backups, deploy.

---

## 11. Deployment strategy (providers still open)

- App host (recommended default): **Vercel**; alternatives: Netlify/Render/Railway/self-host.
- Managed Postgres (recommended default): **Neon** or **Supabase**; alternatives: Railway/Render/self-host.
- Environments: local (pgserver) → preview (per-PR) → production; migrations on deploy; imports are deliberate manual steps.
- Backups: managed DB backups + periodic CSV/JSON export snapshots.
- No provider, domain, or region is locked in.

---

## 12. Risks & unresolved decisions

1. **Hosting & DB providers** — unassumed; need your pick (or "you decide"). Default: Vercel + Neon/Supabase.
2. **Final branding** — colors/logo/type/domain deferred; neutral premium theme until decided (black-and-gold not locked).
3. **User account ↔ canonical player linking** — admin-verified linking proposed to prevent cross-alias impersonation; needs policy confirmation.
4. **Derived tables recompute vs. store** — plan recomputes head-to-head/stats/standings/HoF from primary data so corrections propagate; confirm acceptable.
5. **Correction approval authority** — who approves disputed-history changes, and whether a review step gates go-live.
6. **Live vs. historical scope timing** — when native EGO competitions begin being entered alongside the imported archive.
7. **Snapshot cadence** — historical import is a copied validated snapshot; confirm whether/how it periodically re-syncs from the source folder.

---

## 13. Guardrails honored this phase

- Work only inside `C:\Users\Cerebro\Documents\8BR`; no nested EGO folder.
- Source data at `Documents\Cueverse Prime\archive_viewer` is **not** modified and **not** wired as a production source.
- No homepage sections built; no fake player/ranking/match/competition data; no unnecessary packages.
