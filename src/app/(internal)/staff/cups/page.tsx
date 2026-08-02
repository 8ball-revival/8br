import { redirect } from 'next/navigation'

// Compatibility alias — Cup management now happens inline on the branded public Cups
// pages (one management implementation): the /cups list (with "+ Create New Cup") and
// the per-cup workspace at /cups/[number]. This obsolete placeholder just redirects.
export default function StaffCupsRedirect() {
  redirect('/cups')
}
