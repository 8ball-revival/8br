/**
 * TEMPORARY development fixtures for the homepage.
 *
 * These are dev-only mock objects, kept behind `getHomeData()` so every homepage
 * panel is fed by this single seam. When we wire the real backend, replace each
 * getter body with a Payload/Prisma query returning the SAME shape — the panel
 * components never change. NONE of this is real competition data.
 *
 * Icons are referenced by string key (see ICON_MAP in the components) so this
 * module stays a plain serializable data layer with no React imports.
 */

export interface StandingEntry {
  rank: number
  name: string
  country: string // ISO-ish 2-letter code, rendered as a placeholder flag
  wins: number
  losses: number
  rating: number
  you?: boolean
}

export interface UpcomingEvent {
  id: string
  title: string
  subtitle: string
  days: number
  kind: 'registration' | 'group' | 'playoff' | 'final'
}

export interface MatchSide {
  name: string
  country: string
  rank?: number
  score: number
}

export interface FeaturedMatch {
  raceTo: number
  live: boolean
  a: MatchSide
  b: MatchSide
  watchHref: string
}

export interface ResultRow {
  id: string
  competition: string
  competitionTone: 'tournament' | 'cup' | 'invitational' | 'special'
  date: string // display date
  a: { name: string; country: string; score: number }
  b: { name: string; country: string; score: number }
  winner: 'a' | 'b'
}

export interface NewsItem {
  id: string
  title: string
  blurb: string
  ago: string
  kind: 'registration' | 'rulebook' | 'cup' | 'hof'
  href: string
}

export interface SpotlightPlayer {
  name: string
  country: string
  seasonTitles: number
  cupTitles: number
  record: string
  currentRank: number
  highestRank: number
  memberSince: number
  href: string
}

export interface StatItem {
  id: string
  icon: 'history' | 'seasons' | 'matches' | 'players' | 'champions' | 'countries' | 'games'
  value: string
  label: string
  sub?: string
}

export interface OnThisDayItem {
  id: string
  date: string // display, e.g. "May 12, 2008"
  text: string
  player: string
}

export interface HeroData {
  seasonLabel: string
  headingTop: string
  headingBottom: string
  subtext: string
  registrationClosesAt: string // ISO — the countdown target
  deadlineNote: string
  registerHref: string
  rulesHref: string
}

export interface Registrant {
  name: string
  handle: string // the "ID" column — competitive handle / gamertag
  discord: string // kept in data; not shown publicly on the homepage
  timezone: string
}

export interface HomeData {
  hero: HeroData
  upcomingEvents: UpcomingEvent[]
  registrations: Registrant[]
  standings: StandingEntry[]
  featuredMatch: FeaturedMatch
  recentResults: ResultRow[]
  news: NewsItem[]
  spotlight: SpotlightPlayer
  byTheNumbers: StatItem[]
  onThisDay: OnThisDayItem[]
}

const HOME_FIXTURE: HomeData = {
  hero: {
    seasonLabel: 'Tournament 2',
    headingTop: 'Registration',
    headingBottom: 'Now Open',
    subtext: 'Compete against the best. Chase the title. Make history.',
    // Registration closes Aug 28, 2026 at 6:00 AM MST (UTC-7) — the countdown target.
    registrationClosesAt: '2026-08-28T06:00:00-07:00',
    deadlineNote: 'Registration closes Aug 28, 2026 · 6:00 AM MST — brackets available shortly after.',
    registerHref: '/register',
    rulesHref: '/rules',
  },

  upcomingEvents: [
    { id: 'e1', title: 'Tournament 2 Registration', subtitle: 'Registration Closes', days: 28, kind: 'registration' },
    { id: 'e2', title: 'Tournament 2 Week 1', subtitle: 'Group Stage Begins', days: 35, kind: 'group' },
    { id: 'e3', title: 'Tournament 2 Playoffs', subtitle: 'Top 16 Compete', days: 61, kind: 'playoff' },
    { id: 'e4', title: 'Tournament 2 Finals', subtitle: 'Crown the Champion', days: 89, kind: 'final' },
  ],

  // Real Tournament 2 entrants (dev fixture). Swap for a Payload/Prisma query later.
  registrations: [
    { name: 'Neo', handle: 'Starkiller', discord: 'stepatdis', timezone: 'MST' },
    { name: 'Kevin', handle: 'sixohtwo', discord: 'draftcat', timezone: 'EST' },
    { name: 'Travis', handle: 'Travis', discord: 'takeo9820', timezone: 'EST' },
    { name: 'Sid', handle: 'easyrun', discord: 'sidlerr_', timezone: 'BST' },
    { name: 'Brice', handle: 'Bricycle', discord: 'planetnine9', timezone: 'EST' },
    { name: 'Craig', handle: 'Chiddy', discord: 'chiddy0807', timezone: 'EST' },
    { name: 'Derrick', handle: '₲ØĐⱠł₭Ɇ₊⊹', discord: 'fowl5221', timezone: 'EST' },
    { name: 'Missy', handle: 'ℳ𝒾𝓼𝓼𝓎♥︎', discord: '.pink.___05817', timezone: 'EST' },
    { name: 'Luke', handle: '𒆙ʟʊӄɛ', discord: '.pink.___05817', timezone: 'EST' },
    { name: 'Koty', handle: 'Xx_Koty_xX', discord: 'xxkotyxx', timezone: 'CST' },
    { name: 'George', handle: 'xlx_ogges_xlx', discord: 'ogges1989', timezone: 'UK' },
    { name: 'Jeremy', handle: 'pro_jeremy', discord: 'ogjerbear', timezone: 'CST' },
    { name: 'Cameron', handle: 'Cam', discord: 'cameron.skillz', timezone: 'CST' },
    { name: 'Irfan', handle: 'irfs07', discord: 'irfan091010', timezone: 'EST' },
    { name: 'Justin', handle: 'Cue', discord: 'jzillawz', timezone: 'EST' },
    { name: 'Leigh', handle: 'LJ', discord: 'leighjohn__', timezone: 'ACST' },
    { name: 'Faisal', handle: 'Faisal', discord: 'sicc1', timezone: 'PKST' },
    { name: 'Chiraag', handle: 'i.am_the_zodiac', discord: 'jabronni16', timezone: 'GMT' },
    { name: 'Saqib', handle: 'NooB', discord: 'saqs4115', timezone: 'PKST' },
    { name: 'Steve', handle: 'n00bski11z', discord: 'bigsteve_1991', timezone: 'UK' },
    { name: 'Stu', handle: 'Stu', discord: 'stu00405', timezone: 'GMT' },
    { name: 'Jefe', handle: 'JEFE', discord: 'amteban9130', timezone: 'CST' },
    { name: 'Nakz', handle: '_1_', discord: 'nakz_2917', timezone: 'GMT' },
    { name: 'Sean', handle: 'Lilsparky67', discord: 'lilsparky67', timezone: 'EST' },
    { name: 'Peter', handle: 'eskimo', discord: 'whishy', timezone: 'EST' },
  ],

  standings: [
    { rank: 1, name: 'Kevin', country: 'US', wins: 6, losses: 1, rating: 1980 },
    { rank: 2, name: 'Sid', country: 'US', wins: 6, losses: 1, rating: 1940 },
    { rank: 3, name: 'Cerebro', country: 'CA', wins: 5, losses: 2, rating: 1780, you: true },
    { rank: 4, name: 'Travis', country: 'US', wins: 5, losses: 2, rating: 1650 },
    { rank: 5, name: 'Bilal', country: 'GB', wins: 4, losses: 3, rating: 1420 },
    { rank: 6, name: 'Shaw', country: 'FI', wins: 4, losses: 3, rating: 1310 },
    { rank: 7, name: 'James', country: 'GB', wins: 3, losses: 4, rating: 1180 },
    { rank: 8, name: 'Ant', country: 'US', wins: 3, losses: 4, rating: 1070 },
    { rank: 9, name: 'Marty', country: 'US', wins: 2, losses: 5, rating: 930 },
    { rank: 10, name: 'Iceman', country: 'FI', wins: 2, losses: 5, rating: 890 },
  ],

  featuredMatch: {
    raceTo: 9,
    live: true,
    a: { name: 'Kevin', country: 'US', rank: 1, score: 7 },
    b: { name: 'Cerebro', country: 'CA', rank: 3, score: 5 },
    watchHref: '/live',
  },

  recentResults: [
    { id: 'r1', competition: 'Tournament 2 · Week 2', competitionTone: 'tournament', date: 'May 12, 2024', a: { name: 'Sid', country: 'US', score: 9 }, b: { name: 'Travis', country: 'CA', score: 7 }, winner: 'a' },
    { id: 'r2', competition: 'Legends Cup · Final', competitionTone: 'cup', date: 'May 18, 2024', a: { name: 'Cerebro', country: 'CA', score: 10 }, b: { name: 'Kevin', country: 'US', score: 8 }, winner: 'a' },
    { id: 'r3', competition: 'Underdog Open · Final', competitionTone: 'special', date: 'May 19, 2024', a: { name: 'Bilal', country: 'GB', score: 8 }, b: { name: 'Marty', country: 'US', score: 6 }, winner: 'a' },
    { id: 'r4', competition: 'Masters Invitational · Semifinals', competitionTone: 'invitational', date: 'May 20, 2024', a: { name: 'James', country: 'GB', score: 9 }, b: { name: 'Iceman', country: 'FI', score: 4 }, winner: 'a' },
  ],

  news: [
    { id: 'n1', title: 'Tournament 2 Registration Now Open!', blurb: 'Register now to compete in Tournament 2.', ago: '2 hours ago', kind: 'registration', href: '/news' },
    { id: 'n2', title: 'Rulebook Update', blurb: 'New rule clarifications for Tournament 2.', ago: '3 days ago', kind: 'rulebook', href: '/news' },
    { id: 'n3', title: 'Legends Cup Announced', blurb: 'A special invitational featuring the all-time greats.', ago: '5 days ago', kind: 'cup', href: '/news' },
    { id: 'n4', title: 'Hall of Fame Class of 2024', blurb: 'Vote now for this year’s inductees.', ago: '1 week ago', kind: 'hof', href: '/news' },
  ],

  spotlight: {
    name: 'Luis',
    country: 'US',
    seasonTitles: 6,
    cupTitles: 12,
    record: '24–7',
    currentRank: 3,
    highestRank: 1,
    memberSince: 2005,
    href: '/players',
  },

  byTheNumbers: [
    { id: 's1', icon: 'history', value: '21', label: 'Years of History', sub: 'Since 2004' },
    { id: 's2', icon: 'seasons', value: '53', label: 'Seasons' },
    { id: 's3', icon: 'matches', value: '3,412', label: 'Matches Played' },
    { id: 's4', icon: 'players', value: '612', label: 'Players' },
    { id: 's5', icon: 'champions', value: '19', label: 'Champions' },
    { id: 's6', icon: 'countries', value: '8', label: 'Countries' },
    { id: 's7', icon: 'games', value: '4,827', label: 'Games Played' },
  ],

  onThisDay: [
    { id: 'd1', date: 'May 12, 2008', text: 'Luis defeated James 9–6 to win his 3rd championship.', player: 'Luis' },
    { id: 'd2', date: 'Aug 03, 2011', text: 'Kevin completed an undefeated group stage for the first time.', player: 'Kevin' },
    { id: 'd3', date: 'Nov 21, 2006', text: 'The first 8BRCAM Masters Invitational was held.', player: 'Sid' },
  ],
}

/** Single data seam for the homepage. Swap each field for a real query later. */
export function getHomeData(): HomeData {
  return HOME_FIXTURE
}
