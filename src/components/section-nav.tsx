import { Container } from '@/components/ui/container'

export interface SectionNavItem {
  id: string
  label: string
}

/** Generic in-page anchor section nav (server-rendered), sticky below the header. */
export function SectionNav({
  sections,
  ariaLabel = 'Page sections',
}: {
  sections: SectionNavItem[]
  ariaLabel?: string
}) {
  return (
    <div className="sticky top-16 z-30 border-b border-border bg-background/85 backdrop-blur">
      <Container>
        <nav aria-label={ariaLabel} className="-mx-1 flex gap-1 overflow-x-auto py-2">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {s.label}
            </a>
          ))}
        </nav>
      </Container>
    </div>
  )
}
