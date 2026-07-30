import { Container } from '@/components/ui/container'

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'groups', label: 'Groups' },
  { id: 'standings', label: 'Standings' },
  { id: 'schedule', label: 'Schedule & Results' },
  { id: 'playoffs', label: 'Playoffs' },
  { id: 'rules', label: 'Rules' },
  { id: 'sources', label: 'Sources' },
]

/**
 * In-page section navigation (anchor links). Server-rendered — all sections stay
 * in the DOM (good for SEO + no client JS); sticky below the site header.
 */
export function SeasonSectionNav() {
  return (
    <div className="sticky top-16 z-30 border-b border-border bg-background/85 backdrop-blur">
      <Container>
        <nav aria-label="Season sections" className="-mx-1 flex gap-1 overflow-x-auto py-2">
          {SECTIONS.map((s) => (
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
