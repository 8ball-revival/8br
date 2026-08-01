/**
 * Hall of Fame data (dev fixture). "Top 10 All Time" = most season championships,
 * counting ONLY group + season play (cups excluded). Swap for a Payload/Prisma
 * query later; components stay the same.
 */

export interface HofPlayer {
  slug: string
  name: string
  handle: string
  titles: number
  yearsWon: string[] // season ids, e.g. "2005-S1"
}

// Order = the all-time ranking (most season titles first).
const TOP10: HofPlayer[] = [
  { slug: 'luis', name: 'Luis', handle: 'deep.cerebro', titles: 6, yearsWon: ['2005-S1', '2006-S1', '2006-S3', '2006-S4', '2008-S1', '2012-S3'] },
  { slug: 'ant', name: 'Ant', handle: 'good-faith', titles: 6, yearsWon: ['2007-S6', '2009-S3', '2010-S1', '2011-S2', '2011-S5', '2012-S1'] },
  { slug: 'mj', name: 'MJ', handle: 'MJ_The_King', titles: 4, yearsWon: ['2005-S4', '2009-S4', '2009-S5', '2013-S5'] },
  { slug: 'kevin', name: 'Kevin', handle: 'sixohtwo', titles: 3, yearsWon: ['2008-S5', '2014-S1', '2026-S1'] },
  { slug: 'james', name: 'James', handle: 'cue.ball', titles: 3, yearsWon: ['2006-S6', '2007-S4', '2007-S5'] },
  { slug: 'chris', name: 'Chris', handle: 'chris.dogg', titles: 3, yearsWon: ['2006-S2', '2007-S2', '2007-S3'] },
  { slug: 'si', name: 'Si', handle: 'xxl_themachine_lxx', titles: 2, yearsWon: ['2009-S1', '2009-S2'] },
  { slug: 'charlie', name: 'Charlie', handle: 'p00l_charlie', titles: 2, yearsWon: ['2008-S2', '2008-S3'] },
  { slug: 'stu', name: 'Stu', handle: 'zl_stu_lz', titles: 2, yearsWon: ['2009-S6', '2011-S4'] },
  { slug: 'ck', name: 'CK', handle: 'Xx_CK_xX', titles: 2, yearsWon: ['2010-S2', '2011-S3'] },
]

export function getTop10(): HofPlayer[] {
  return TOP10
}

export function getHofPlayer(slug: string): HofPlayer | undefined {
  return TOP10.find((p) => p.slug === slug)
}

/** "2005-S1" -> "2005 · Season 1" */
export function formatSeasonId(id: string): string {
  const [year, s] = id.split('-')
  const n = s?.replace(/^s/i, '')
  return n ? `${year} · Season ${n}` : id
}
