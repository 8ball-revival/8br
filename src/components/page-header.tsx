import { Container } from '@/components/ui/container'
import { Breadcrumbs, type Crumb } from '@/components/ui/breadcrumb'
import { Badge } from '@/components/ui/badge'

/** Standard inner-page header band: breadcrumbs, title, description, optional actions. */
export function PageHeader({
  breadcrumbs,
  title,
  description,
  sample = false,
  actions,
}: {
  breadcrumbs?: Crumb[]
  title: string
  description?: string
  sample?: boolean
  actions?: React.ReactNode
}) {
  return (
    <div className="relative border-b border-[var(--neon-line)] bg-card/30 after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-[linear-gradient(90deg,var(--neon-cyan),transparent_45%)] after:opacity-70">
      <Container className="py-10">
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} className="mb-4" />}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-3xl font-bold uppercase tracking-tight [text-shadow:0_0_22px_oklch(0.84_0.14_200/0.22)] sm:text-4xl">{title}</h1>
              {sample && <Badge variant="muted">Sample data</Badge>}
            </div>
            {description && (
              <p className="mt-3 max-w-2xl text-muted-foreground">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </Container>
    </div>
  )
}
