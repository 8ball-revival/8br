import { HANDBOOK, type HandbookBlock, type HandbookSubsection } from '@/lib/rules/handbook'

/** Anchor id for a section, e.g. 1 -> "sec-1". */
export function sectionAnchor(n: number): string {
  return `sec-${n}`
}

/** Anchor id for a subsection, e.g. "1.1" -> "sec-1-1". */
function subsectionAnchor(num: string): string {
  return `sec-${num.replace(/\./g, '-')}`
}

function Block({ block }: { block: HandbookBlock }) {
  switch (block.k) {
    case 'p':
      return <p className="text-[0.95rem] leading-relaxed text-muted-foreground">{block.text}</p>
    case 'ul':
      return (
        <ul className="list-disc space-y-1.5 pl-5 text-[0.95rem] leading-relaxed text-muted-foreground marker:text-gold/70">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <div className="space-y-2">
          {block.title && (
            <p className="text-sm font-semibold text-foreground">{block.title}</p>
          )}
          <ol className="list-decimal space-y-1.5 pl-5 text-[0.95rem] leading-relaxed text-muted-foreground marker:font-semibold marker:text-gold/80">
            {block.items.map((item, i) => (
              <li key={i} className="pl-1">
                {item}
              </li>
            ))}
          </ol>
        </div>
      )
    case 'dl':
      return (
        <dl className="space-y-2">
          {block.items.map((item, i) => (
            <div
              key={i}
              className="flex flex-col gap-0.5 border-l-2 border-gold/40 pl-3 sm:flex-row sm:gap-2"
            >
              <dt className="font-semibold text-foreground">{item.term}</dt>
              <dd className="text-[0.95rem] leading-relaxed text-muted-foreground sm:before:mr-1 sm:before:text-muted-foreground/60 sm:before:content-['\2014']">
                {item.def}
              </dd>
            </div>
          ))}
        </dl>
      )
    case 'example':
      return (
        <div className="rounded-md border border-border bg-card/40 px-4 py-3">
          <p className="eyebrow mb-1 text-gold">Example</p>
          <p className="text-[0.95rem] leading-relaxed text-muted-foreground">{block.text}</p>
        </div>
      )
  }
}

function Subsection({ sub }: { sub: HandbookSubsection }) {
  const anchor = subsectionAnchor(sub.number)
  return (
    <section id={anchor} className="scroll-mt-28">
      <h3 className="group flex items-baseline gap-2 font-display text-base font-semibold tracking-tight text-foreground sm:text-lg">
        <span className="tabular text-gold">{sub.number}</span>
        <a href={`#${anchor}`} className="hover:text-gold">
          {sub.title}
        </a>
      </h3>
      <div className="mt-2.5 space-y-3">
        {sub.blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>
    </section>
  )
}

/** Full handbook body — all 12 sections with their subsections. */
export function HandbookBody() {
  return (
    <div className="space-y-14">
      {HANDBOOK.map((section) => (
        <section
          key={section.number}
          id={sectionAnchor(section.number)}
          className="scroll-mt-24"
          aria-labelledby={`${sectionAnchor(section.number)}-heading`}
        >
          <div className="flex items-center gap-3 border-b border-border pb-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-gold/15 text-sm font-bold text-gold tabular">
              {section.number}
            </span>
            <h2
              id={`${sectionAnchor(section.number)}-heading`}
              className="font-display text-xl font-bold tracking-tight sm:text-2xl"
            >
              {section.title}
            </h2>
          </div>
          <div className="mt-6 space-y-8">
            {section.subsections.map((sub) => (
              <Subsection key={sub.number} sub={sub} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
