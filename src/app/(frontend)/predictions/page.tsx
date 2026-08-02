import type { Metadata } from 'next'
import { Sparkles, Target, Trophy, MessagesSquare, LineChart, Star } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { pageMetadata } from '@/lib/site'

export const metadata: Metadata = pageMetadata({
  title: 'Predictions',
  description:
    'Predictions are coming soon to 8 Ball Revival — publish match predictions, tournament picks, analysis, and upset calls directly on 8br.gg.',
  path: '/predictions',
})

const PLANNED: { icon: typeof Target; title: string; body: string }[] = [
  { icon: Target, title: 'Match predictions', body: 'Call the score on upcoming Season and Cup matchups.' },
  { icon: Trophy, title: 'Tournament predictions', body: 'Pick group qualifiers, bracket runs, and champions.' },
  { icon: MessagesSquare, title: 'Community analysis', body: 'Share breakdowns, form reads, and upset calls.' },
  { icon: LineChart, title: 'Prediction accuracy tracking', body: 'Build a record — see who actually calls it right.' },
  { icon: Star, title: 'Featured prediction posts', body: 'The best analysis gets highlighted across the site.' },
]

export default function PredictionsPage() {
  return (
    <Container className="py-12">
      {/* Coming Soon hero */}
      <div className="relative mx-auto max-w-3xl overflow-hidden rounded-2xl border border-border bg-card/40 px-6 py-14 text-center sm:px-12">
        <div className="bg-grid absolute inset-0 opacity-40" aria-hidden />
        <div className="absolute -top-24 left-1/2 h-48 w-96 max-w-[90vw] -translate-x-1/2 rounded-full bg-gold/10 blur-3xl" aria-hidden />
        <div className="relative">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full border border-gold/25 bg-gold/10 text-gold">
            <Sparkles className="size-7" aria-hidden />
          </span>
          <p className="eyebrow mt-5 text-gold">Predictions</p>
          <h1 className="mt-2 font-display text-4xl font-bold uppercase leading-[0.95] tracking-tight sm:text-5xl">
            <span className="block text-gold-gradient">Coming Soon</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground text-pretty">
            Soon, registered 8 Ball Revival members will be able to publish match predictions, tournament picks,
            analysis, and upset calls directly on 8br.gg.
          </p>
          <div className="mt-6 flex justify-center">
            <Badge variant="muted">Under development</Badge>
          </div>
        </div>
      </div>

      {/* Planned features */}
      <section className="mx-auto mt-12 max-w-4xl">
        <h2 className="eyebrow mb-5 text-center text-muted-foreground">Planned features</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PLANNED.map((f) => (
            <div key={f.title} className="rounded-lg border border-border bg-card/40 p-5">
              <span className="flex size-10 items-center justify-center rounded-lg border border-gold/20 bg-gold/10 text-gold">
                <f.icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 font-display text-base font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          This feature is currently under development while we finish the competition management tools.
        </p>
      </section>
    </Container>
  )
}
