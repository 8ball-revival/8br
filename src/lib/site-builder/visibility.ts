/**
 * Evaluating visibility rules, and describing them in English.
 *
 * ── Where this runs, and why it matters ──────────────────────────────────────────────────────────
 * On the SERVER, during render. A rule that hid a module in the browser would still have shipped the
 * module's markup and its data to everyone — which for a rule like "administrators only" is not
 * hiding at all. Deciding here means a hidden module is absent from the response.
 *
 * ── Why there is no expression language ──────────────────────────────────────────────────────────
 * Every condition is a fixed subject, a fixed operator and an enumerated operand. There is nothing
 * to parse and nothing to evaluate, so "hide this until registration opens" cannot become a way to
 * run something. The cost is that a genuinely novel condition needs a new subject added here; that
 * is the right trade for a control an administrator uses without review.
 *
 * Conditions are ANDed. An administrator who wants "either" builds two modules — which reads more
 * clearly in the inspector than a nested boolean tree, and is far harder to get subtly wrong.
 */

import type { Breakpoint, Condition, VisibilityRule } from './document'
import type { RenderContext } from './registry'

/** Facts a rule may be evaluated against. Assembled once per page, not per module. */
export interface VisibilityFacts {
  now: Date
  signedIn: boolean
  isAdmin: boolean
  route: string
  currentYear: number
  seasonStatus?: string
  registrationOpen?: boolean
  groupsPublished?: boolean
  playoffsPublished?: boolean
  platform?: string
  /** Whether the module's own data source returned anything. */
  dataAvailable?: boolean
}

export function factsFor(context: RenderContext, extra: Partial<VisibilityFacts> = {}): VisibilityFacts {
  const now = new Date()
  return {
    now,
    signedIn: context.viewer?.signedIn ?? false,
    isAdmin: context.viewer?.isAdmin ?? false,
    route: context.route,
    currentYear: now.getUTCFullYear(),
    ...extra,
  }
}

/**
 * Should this be rendered at all?
 *
 * `hidden` is checked first and separately from conditions: "temporarily hide" is a distinct act
 * from "show only when...", and collapsing them would mean un-hiding a module silently discarded
 * the schedule an administrator had set on it.
 *
 * Breakpoint visibility is NOT decided here — it is a CSS concern, handled by `visibilityClasses`,
 * because the server cannot know the viewport and guessing would send the wrong thing to somebody.
 */
export function isVisible(rule: VisibilityRule | undefined, facts: VisibilityFacts): boolean {
  if (!rule) return true
  if (rule.hidden) return false
  if (!rule.conditions?.length) return true
  return rule.conditions.every((c) => {
    const holds = evaluate(c, facts)
    return c.negate ? !holds : holds
  })
}

function evaluate(c: Condition, f: VisibilityFacts): boolean {
  switch (c.subject) {
    case 'dateWindow': {
      // An open-ended window is legitimate on both sides: "from launch, forever" and "until the
      // season starts" are both things an administrator schedules.
      const from = c.from ? Date.parse(c.from) : null
      const to = c.to ? Date.parse(c.to) : null
      const t = f.now.getTime()
      if (from !== null && t < from) return false
      if (to !== null && t > to) return false
      return true
    }
    case 'signedIn': return f.signedIn
    case 'isAdmin': return f.isAdmin
    // Device is a viewport question, and the server has no viewport. It is expressed as a class by
    // `hideOn` instead; a device CONDITION would have to guess, and would be wrong for somebody.
    case 'device': return true
    case 'seasonStatus': return !!c.value && f.seasonStatus === c.value
    case 'registrationOpen': return f.registrationOpen === true
    case 'groupsPublished': return f.groupsPublished === true
    case 'playoffsPublished': return f.playoffsPublished === true
    case 'competitionPlatform': return !!c.value && f.platform === c.value
    case 'dataAvailable': return f.dataAvailable !== false
    case 'currentYear': return !!c.value && String(f.currentYear) === c.value
    case 'route': return !!c.value && f.route === c.value
  }
}

// ── Plain language ──────────────────────────────────────────────────────────────────────────────

const SUBJECT_PHRASES: Record<Condition['subject'], (c: Condition) => string> = {
  dateWindow: (c) => {
    const from = c.from ? new Date(c.from).toLocaleString() : null
    const to = c.to ? new Date(c.to).toLocaleString() : null
    if (from && to) return `between ${from} and ${to}`
    if (from) return `from ${from} onwards`
    if (to) return `until ${to}`
    return 'within a date window that has not been set'
  },
  signedIn: () => 'the visitor is signed in',
  isAdmin: () => 'the visitor is an administrator',
  device: (c) => `the visitor is on ${c.value ?? 'a device'}`,
  seasonStatus: (c) => `the Season status is ${c.value ?? '—'}`,
  registrationOpen: () => 'registration is open',
  groupsPublished: () => 'the groups have been published',
  playoffsPublished: () => 'the playoffs have been published',
  competitionPlatform: (c) => `the competition is ${c.value ?? '—'}`,
  dataAvailable: () => 'there is data to show',
  currentYear: (c) => `the year is ${c.value ?? '—'}`,
  route: (c) => `the page is ${c.value ?? '—'}`,
}

/** One condition, as a sentence fragment an administrator can check at a glance. */
export function describeCondition(c: Condition): string {
  const phrase = SUBJECT_PHRASES[c.subject](c)
  return c.negate ? `NOT ${phrase}` : phrase
}

/** The whole rule, as a sentence. */
export function describeVisibility(rule: VisibilityRule | undefined, hideOn?: Breakpoint[]): string {
  const parts: string[] = []
  if (rule?.hidden) return 'Hidden. This is not shown to anybody.'
  if (rule?.conditions?.length) {
    parts.push(`Shown when ${rule.conditions.map(describeCondition).join(', and ')}`)
  } else {
    parts.push('Always shown')
  }
  const hidden = hideOn ?? rule?.hideOn
  if (hidden?.length) parts.push(`except on ${hidden.join(' and ')}`)
  return `${parts.join(', ')}.`
}

/**
 * Combinations that can never be true, reported before an administrator publishes one.
 *
 * A rule that cannot hold is not an error — it is a module that has silently vanished from the site,
 * which is far more confusing to diagnose than a warning at the point of setting it.
 */
export function impossibleCombinations(rule: VisibilityRule | undefined): string[] {
  if (!rule?.conditions?.length) return []
  const out: string[] = []
  const cs = rule.conditions

  for (const c of cs) {
    if (c.subject === 'dateWindow' && c.from && c.to && Date.parse(c.from) > Date.parse(c.to)) {
      out.push('The date window ends before it starts, so this will never be shown.')
    }
  }
  const has = (s: Condition['subject'], negate: boolean) =>
    cs.some((c) => c.subject === s && !!c.negate === negate)
  for (const s of ['signedIn', 'isAdmin', 'registrationOpen', 'groupsPublished', 'playoffsPublished'] as const) {
    if (has(s, false) && has(s, true)) {
      out.push(`This requires "${s}" to be both true and false, so it will never be shown.`)
    }
  }
  // Two different values for a subject that can only hold one at a time.
  for (const s of ['seasonStatus', 'competitionPlatform', 'currentYear', 'route'] as const) {
    const values = new Set(cs.filter((c) => c.subject === s && !c.negate).map((c) => c.value))
    if (values.size > 1) {
      out.push(`This requires ${s} to be ${[...values].join(' and ')} at once, so it will never be shown.`)
    }
  }
  // Everything hidden at every breakpoint is the same outcome as being hidden outright.
  if (rule.hideOn && rule.hideOn.length === 3) {
    out.push('This is hidden on desktop, tablet and mobile, so it will never be seen.')
  }
  return [...new Set(out)]
}
