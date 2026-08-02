import { redirect } from 'next/navigation'

// Compatibility alias — group management now happens inline on the branded public
// Groups page (one management implementation). See /groups?edit=true.
export default function StaffGroupsRedirect() {
  redirect('/groups?edit=true')
}
