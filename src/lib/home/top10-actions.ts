'use server'

import { getTop10, type Top10Mode, type Top10Result } from './top10'

/**
 * Fetch a ranking mode for the homepage panel.
 *
 * A Server Action rather than an API route so the panel can swap modes without a navigation, while
 * the queries stay on the server — the dropdown never ships ranking logic or a database shape to the
 * browser.
 *
 * Public data, so there is no permission check here: this returns exactly what the homepage already
 * renders to everybody. The mode is validated against the real option list before use, so a crafted
 * value cannot reach a query.
 */
export async function fetchTop10Action(mode: string): Promise<Top10Result> {
  const { getTop10Options, normaliseMode } = await import('./top10')
  const safe: Top10Mode = normaliseMode(mode, await getTop10Options())
  return getTop10(safe)
}
