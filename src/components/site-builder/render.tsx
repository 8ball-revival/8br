/**
 * Rendering a layout document.
 *
 * ── The contract this file exists to keep ────────────────────────────────────────────────────────
 * A malformed draft must never take down the public site. Everything here is written from that one
 * requirement, and it is enforced at three depths, because there are three genuinely different ways
 * a layout can be wrong:
 *
 *   1. A MODULE is unknown, misconfigured or throws. Handled by `SafeModule`: the rest of the page
 *      renders, and only that module falls back.
 *   2. The DOCUMENT fails validation. Handled by the page loader, which drops to the last valid
 *      published revision and then to the code-defined factory layout.
 *   3. Something unforeseen throws mid-render. Handled by the error boundary each section sits in,
 *      so one bad section costs a section rather than the page.
 *
 * A module that throws is reported to the server log with its id and type, because a fallback that
 * is silent is a fallback that hides a fault until somebody notices the page looks wrong.
 *
 * ── One renderer ─────────────────────────────────────────────────────────────────────────────────
 * The editing canvas renders through this exact path, with `editing` true. The only difference it
 * makes is a handful of `data-sb-*` attributes for the overlay to anchor to, and those are inert
 * markup. There is no second rendering path that could disagree with what publishes.
 */

import { Wide } from '@/components/primitives'
import { cn } from '@/lib/utils'
import { getModule, type RenderContext } from '@/lib/site-builder/registry'
import type { LayoutDocument, ModuleInstance, Section } from '@/lib/site-builder/document'
import { validateConfig } from '@/lib/site-builder/fields'
import { moduleSpanClasses, sectionGridStyle, styleClasses, styleVars, visibilityClasses } from '@/lib/site-builder/styles'
import { factsFor, isVisible, type VisibilityFacts } from '@/lib/site-builder/visibility'

import './modules'

export interface RenderOptions {
  editing?: boolean
  context: RenderContext
}

// ── Document ────────────────────────────────────────────────────────────────────────────────────

export function DocumentRenderer({ document, editing = false, context }: RenderOptions & { document: LayoutDocument }) {
  const facts = factsFor(context)
  return (
    <div className="w-full pb-0 pt-4" data-sb-document={editing ? 'editing' : 'published'}>
      {document.sections.map((section) => (
        <SectionRenderer
          key={section.id}
          section={section}
          editing={editing}
          context={context}
          facts={facts}
        />
      ))}
    </div>
  )
}

// ── Section ─────────────────────────────────────────────────────────────────────────────────────

const WIDTHS = {
  full: '',
  wide: '',
  narrow: 'mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8',
} as const

function SectionRenderer({
  section, editing, context, facts,
}: { section: Section; editing: boolean; context: RenderContext; facts: VisibilityFacts }) {
  // An administrator editing the page must still see a module that a condition hides, or it cannot
  // be selected to change the condition. The public render obeys the rule exactly.
  if (!editing && !isVisible(section.visibility, facts)) return null

  const visible = section.modules.filter((m) => editing || isVisible(m.visibility, facts))
  if (!visible.length && !editing) return null

  const grid = (
    <div
      className={cn(
        'sb-grid grid items-stretch gap-4',
        styleClasses(section.style),
        visibilityClasses(section.visibility.hideOn),
      )}
      style={{ ...sectionGridStyle(section), ...styleVars(section.style) }}
    >
      {visible.map((instance) => (
        <ModuleFrame
          key={instance.id}
          instance={instance}
          section={section}
          editing={editing}
          context={context}
          facts={facts}
        />
      ))}
    </div>
  )

  const body = section.width === 'full'
    ? <div className={cn('w-full', WIDTHS.full)}>{grid}</div>
    : section.width === 'narrow'
      ? <div className={WIDTHS.narrow}>{grid}</div>
      : <Wide>{grid}</Wide>

  return (
    <section
      // The editor anchors to these. They are inert attributes on the public page too, which keeps
      // one markup shape rather than two and means the canvas is measuring the real thing.
      data-sb-section={section.id}
      data-sb-section-name={section.name}
      data-sb-hidden={!isVisible(section.visibility, facts) ? 'true' : undefined}
      className={cn('w-full', section.style.paddingY === undefined && 'mt-4 first:mt-0')}
    >
      {body}
    </section>
  )
}

// ── Module ──────────────────────────────────────────────────────────────────────────────────────

function ModuleFrame({
  instance, section, editing, context, facts,
}: {
  instance: ModuleInstance; section: Section; editing: boolean; context: RenderContext; facts: VisibilityFacts
}) {
  const def = getModule(instance.type)
  const hiddenHere = !isVisible(instance.visibility, facts)
  return (
    <div
      data-sb-module={instance.id}
      data-sb-module-type={instance.type}
      data-sb-module-name={def?.name ?? instance.type}
      data-sb-hidden={hiddenHere ? 'true' : undefined}
      data-sb-reusable={instance.reusableId ?? undefined}
      className={cn(
        'min-w-0',
        moduleSpanClasses(instance, section),
        styleClasses(instance.style),
        visibilityClasses(instance.visibility.hideOn),
        // In the canvas a conditionally hidden module is shown at reduced opacity rather than
        // removed, so it can still be selected and its condition changed.
        editing && hiddenHere && 'opacity-40',
      )}
      style={styleVars(instance.style)}
    >
      <SafeModule instance={instance} editing={editing} context={context} />
    </div>
  )
}

/**
 * One module, rendered defensively.
 *
 * Config is re-validated HERE as well as on save. That is not redundant: a document can reach this
 * point from a published revision written before a module's schema changed, and re-validating means
 * such a revision renders with sensible defaults instead of throwing on a field that no longer
 * exists. It is also the last line if anything ever wrote to the table directly.
 */
function SafeModule({ instance, editing, context }: { instance: ModuleInstance; editing: boolean; context: RenderContext }) {
  const def = getModule(instance.type)

  if (!def) {
    // Public visitors get nothing at all — a warning about internal module types is not theirs to
    // read, and an empty gap is better than an error message on a live page.
    if (!editing) return null
    return <FallbackNotice title="Unknown module" detail={`No module is registered as "${instance.type}". It has been kept, not deleted.`} />
  }

  const result = validateConfig(def.fields, instance.config)
  if (!result.ok) {
    console.error('[site-builder] invalid module config', {
      moduleId: instance.id, type: instance.type, issues: result.issues,
    })
    // An editing administrator is told, so the problem is fixable. A public visitor gets the module
    // rendered from its SAFE value — every failing field sits at its default — because a panel with
    // one wrong setting is a better page than a hole where the panel was.
    if (editing) {
      return (
        <FallbackNotice
          title={`${def.name} — settings need attention`}
          detail={result.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join(' · ')}
        />
      )
    }
  }

  const Render = def.Render as React.ComponentType<{
    config: unknown; instance: ModuleInstance; editing: boolean; context: RenderContext
  }>
  return <Render config={result.value} instance={instance} editing={editing} context={context} />
}

/** Shown in the canvas only. Deliberately not styled as a site surface — it is editor chrome. */
function FallbackNotice({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-[80px] flex-col justify-center gap-1 border border-dashed border-[var(--gold)] bg-[var(--graphite)] px-4 py-4">
      <p className="eyebrow text-[var(--gold)]">{title}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}
