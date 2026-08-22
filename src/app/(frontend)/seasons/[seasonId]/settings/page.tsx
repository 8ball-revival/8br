import { redirect } from 'next/navigation'

/**
 * Season settings moved into Creator's persistent Settings panel.
 *
 * The old page was a separate screen you had to leave the Season to reach; Settings now opens over
 * whatever stage you are working on. The redirect lands on the Setup stage, which is where the
 * record's own details are edited — and Creator's own guard sends anyone without the capability to
 * a not-found, so this does not widen access.
 */
export default async function LegacySeasonSettingsPage({
  params,
}: {
  params: Promise<{ seasonId: string }>
}): Promise<never> {
  const { seasonId } = await params
  redirect(`/creator/seasons/${seasonId}/setup`)
}
