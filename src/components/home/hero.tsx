import Link from 'next/link'
import Image from 'next/image'
import { UserPlus, FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Countdown } from '@/components/home/countdown'
import type { HeroData } from '@/lib/home/fixtures'

/**
 * Hero backdrop — the 8BR trophy-room scene (public/logo/hero-bg.jpg) with
 * readability veils so the hero copy stays legible over it.
 */
export function HeroBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <Image
        src="/logo/hero-bg.jpg"
        alt=""
        fill
        priority
        unoptimized
        sizes="100vw"
        className="object-cover object-center brightness-[1.35]"
      />
      {/* light left veil — only enough to keep the registration copy readable */}
      <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/35 to-transparent" />
      {/* subtle bottom blend into the page */}
      <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-background/60 to-transparent" />
    </div>
  )
}

/** Hero left content: season label, headline, subtext, countdown, primary actions. */
export function Hero({ data }: { data: HeroData }) {
  return (
    <div className="flex max-w-xl flex-col justify-center py-4">
      <p className="eyebrow mb-3 text-gold">{data.seasonLabel}</p>
      <h1 className="font-display text-4xl font-bold uppercase leading-[0.95] tracking-tight sm:text-5xl lg:text-6xl">
        <span className="block text-foreground">{data.headingTop}</span>
        <span className="block text-gold-gradient">{data.headingBottom}</span>
      </h1>
      <p className="mt-4 max-w-md text-base text-muted-foreground">{data.subtext}</p>

      <div className="mt-7">
        <Countdown target={data.registrationClosesAt} />
        {data.deadlineNote && (
          <p className="mt-3 text-xs text-muted-foreground">{data.deadlineNote}</p>
        )}
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild size="xl">
          <Link href={data.registerHref}>
            <UserPlus className="size-4" />
            Register Now
          </Link>
        </Button>
        <Button asChild size="xl" variant="outline">
          <Link href={data.rulesHref}>
            <FileText className="size-4" />
            View Rules
          </Link>
        </Button>
      </div>
    </div>
  )
}
