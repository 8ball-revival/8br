import { redirect } from 'next/navigation'

/** Creating a Tournament now happens in Creator — see the note in seasons/new. */
export default function LegacyNewTournamentPage(): never {
  redirect('/creator/tournaments/new')
}
