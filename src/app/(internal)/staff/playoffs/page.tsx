import { redirect } from 'next/navigation'

// Compatibility alias — playoff management now happens inline on the branded public
// Playoffs page (one management implementation). See /playoffs?edit=true.
export default function StaffPlayoffsRedirect() {
  redirect('/playoffs?edit=true')
}
