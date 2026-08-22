import { Fragment } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export interface ProcessStep {
  title: string
  body: string
}

export interface StageLink {
  label: string
  href: string
}

/**
 * Intentional "coming soon" presentation for a competition stage that has no data
 * yet (groups, playoffs). Reads as a deliberate, professional pre-stage state — an
 * explained process and clear next steps — rather than an empty page.
 */
export function StageComingSoon({
  icon: Icon,
  statusLabel = 'Pending',
  title,
  description,
  steps,
  primary,
  secondary,
  footerLinks,
}: {
  icon: LucideIcon
  statusLabel?: string
  title: string
  description: string
  steps: ProcessStep[]
  primary?: StageLink
  secondary?: StageLink
  footerLinks?: StageLink[]
}) {
  return (
    <div className="mx-auto max-w-3xl">
      {/* Hero panel */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card/40 px-6 py-12 text-center sm:px-12">
        <div className="bg-grid absolute inset-0 opacity-40" aria-hidden />
        <div
          className="absolute -top-24 left-1/2 h-48 w-96 max-w-[90vw] -translate-x-1/2 rounded-full bg-[var(--selected-surface)] blur-3xl"
          aria-hidden
        />
        <div className="relative">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full border border-brand/25 bg-[var(--selected-surface)] text-brand">
            <Icon className="size-7" aria-hidden />
          </span>
          <div className="mt-5 flex justify-center">
            <Badge variant="muted">{statusLabel}</Badge>
          </div>
          <h2 className="mt-4 font-display text-2xl font-bold tracking-tight text-balance sm:text-3xl">
            {title}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground text-pretty">{description}</p>

          {(primary || secondary) && (
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              {primary && (
                <Button asChild size="lg">
                  <Link href={primary.href}>{primary.label}</Link>
                </Button>
              )}
              {secondary && (
                <Button asChild size="lg" variant="outline">
                  <Link href={secondary.href}>{secondary.label}</Link>
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Process */}
      <ol className="mt-10 grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-lg border border-border bg-card/40 p-5">
            <span className="eyebrow text-brand">Step {i + 1}</span>
            <h3 className="mt-2 font-display text-base font-semibold tracking-tight">{s.title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{s.body}</p>
          </li>
        ))}
      </ol>

      {footerLinks && footerLinks.length > 0 && (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          {footerLinks.map((l, i) => (
            <Fragment key={l.href}>
              {i > 0 && <span aria-hidden className="text-border">·</span>}
              <Link href={l.href} className="transition-colors hover:text-foreground">
                {l.label}
              </Link>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
