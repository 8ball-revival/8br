import { redirect } from 'next/navigation'

/**
 * Creating a Cup happens in Creator now.
 *
 * The old standalone create page is gone rather than duplicated: two places to create the same
 * record is two places for the validation to drift. Old links land on the Creator flow with the
 * type already chosen.
 */
export const dynamic = 'force-dynamic'

export default function NewCupRedirect() {
  redirect('/creator/new?type=cup')
}
