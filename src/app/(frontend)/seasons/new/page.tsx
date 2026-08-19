import { redirect } from 'next/navigation'

/** Creating a Season happens in Creator now. See /cups/new for the reasoning. */
export const dynamic = 'force-dynamic'

export default function NewSeasonRedirect() {
  redirect('/creator/new?type=season')
}
