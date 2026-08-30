'use client'

/**
 * The Edit Mode control in the site header.
 *
 * Rendered ONLY when the server has already confirmed the capability, so its presence is not what
 * grants anything — every builder action re-checks server-side, and this button is a shortcut, not
 * a permission.
 *
 * It toggles `?edit=1` on whatever page the administrator is currently looking at, which is the
 * whole idea: editing starts from the page you are reading, not from a separate admin screen you
 * have to navigate to and then find the right page in.
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { PenLine } from 'lucide-react'

import { cn } from '@/lib/utils'

export function EditModeButton({ editable }: { editable: boolean }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const router = useRouter()
  const active = params.get('edit') === '1'

  // Some pages are not builder-managed. Offering the button there would open a toolbar over a page
  // with nothing to edit, which reads as the feature being broken.
  if (!editable) return null

  const toggle = () => {
    const next = new URLSearchParams(params.toString())
    if (active) next.delete('edit')
    else next.set('edit', '1')
    const query = next.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={active ? 'Leave Edit Mode' : 'Edit this page'}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1.5 border px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] transition',
        active
          ? 'border-[var(--hot-red)] bg-[var(--hot-red)] text-white'
          : 'border-[var(--line-strong)] text-muted-foreground hover:border-[var(--hot-red)] hover:text-foreground',
      )}
    >
      <PenLine className="size-3.5" aria-hidden />
      <span className="max-sm:sr-only">Edit</span>
    </button>
  )
}
