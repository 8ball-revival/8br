import { Container } from '@/components/ui/container'
import { cn } from '@/lib/utils'

/**
 * Reusable hero band with a subtle grid + gold glow. Content is passed in so the
 * same frame can front the homepage or a landing section.
 */
export function HeroBanner({
  eyebrow,
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('relative overflow-hidden border-b border-border', className)}>
      <div className="bg-grid absolute inset-0 opacity-50" aria-hidden />
      <div
        className="absolute inset-0 bg-gradient-to-b from-background/10 via-background/50 to-background"
        aria-hidden
      />
      <div
        className="absolute -top-40 left-1/2 h-72 w-[46rem] max-w-[90vw] -translate-x-1/2 rounded-full bg-gold/10 blur-3xl"
        aria-hidden
      />
      <Container className="relative py-20 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          {eyebrow && <p className="eyebrow mb-5 text-gold">{eyebrow}</p>}
          <h1 className="font-display text-5xl font-bold tracking-tight text-balance sm:text-6xl md:text-7xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground text-pretty">{subtitle}</p>
          )}
          {actions && <div className="mt-9 flex flex-wrap items-center justify-center gap-3">{actions}</div>}
        </div>
        {children}
      </Container>
    </section>
  )
}
