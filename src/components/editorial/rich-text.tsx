import Link from 'next/link'
import { isExternalHref, type BlockNode, type InlineNode, type RichDocument } from '@/lib/editorial/richtext'

/**
 * Render an article body.
 *
 * Every node becomes a React element. `dangerouslySetInnerHTML` appears nowhere in this file, and
 * that is the point: a body is a validated node tree, so text is text and there is no path by which
 * an author could produce markup. React escapes the text nodes on the way out for free.
 *
 * A node type this renderer does not know about renders as nothing rather than as a guess. Combined
 * with `sanitizeDocument` dropping unknown nodes on the way in, an unrecognised node is inert at
 * both ends.
 */
export function RichText({ doc, className }: { doc: RichDocument; className?: string }) {
  return (
    <div className={className}>
      {doc.blocks.map((block, i) => <Block key={i} node={block} />)}
    </div>
  )
}

function Block({ node }: { node: BlockNode }) {
  switch (node.t) {
    case 'p':
      return <p className="mb-5 leading-[1.75] text-foreground/90"><Inline nodes={node.c} /></p>

    case 'h': {
      // The article title is the page's H1, so body headings start at H2 and the outline stays valid.
      const cls = node.level === 2
        ? 'mt-10 mb-4 font-display text-2xl font-bold tracking-tight'
        : node.level === 3
          ? 'mt-8 mb-3 font-display text-xl font-semibold tracking-tight'
          : 'mt-6 mb-2 font-display text-base font-semibold uppercase tracking-wide text-muted-foreground'
      if (node.level === 2) return <h2 className={cls}><Inline nodes={node.c} /></h2>
      if (node.level === 3) return <h3 className={cls}><Inline nodes={node.c} /></h3>
      return <h4 className={cls}><Inline nodes={node.c} /></h4>
    }

    case 'ul':
      return (
        <ul className="mb-5 ml-5 list-disc space-y-1.5 leading-[1.7] text-foreground/90 marker:text-brand">
          {node.items.map((item, i) => <li key={i}><Inline nodes={item} /></li>)}
        </ul>
      )

    case 'ol':
      return (
        <ol className="mb-5 ml-5 list-decimal space-y-1.5 leading-[1.7] text-foreground/90 marker:text-brand">
          {node.items.map((item, i) => <li key={i}><Inline nodes={item} /></li>)}
        </ol>
      )

    case 'quote':
      return (
        <blockquote className="mb-5 border-l-2 border-brand/50 pl-4 italic text-foreground/80">
          <Inline nodes={node.c} />
        </blockquote>
      )

    case 'code':
      return (
        <pre className="mb-5 overflow-x-auto rounded-lg border border-border bg-card/60 p-4 text-sm">
          <code>{node.v}</code>
        </pre>
      )

    case 'hr':
      return <hr className="my-8 border-border" />

    case 'img':
      return (
        <figure className="mb-6">
          {/* Payload serves media by filename from its own route; no external host is involved. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- Payload media, not a static asset */}
          <img
            src={`/api/media/file/${node.mediaId}`}
            alt={node.alt}
            className="w-full rounded-lg border border-border"
            loading="lazy"
          />
          {node.caption && (
            <figcaption className="mt-2 text-center text-xs text-muted-foreground">{node.caption}</figcaption>
          )}
        </figure>
      )

    default:
      return null
  }
}

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.t) {
          case 'text':
            return <span key={i}>{node.v}</span>
          case 'strong':
            return <strong key={i} className="font-semibold text-foreground"><Inline nodes={node.c} /></strong>
          case 'em':
            return <em key={i}><Inline nodes={node.c} /></em>
          case 'code':
            return <code key={i} className="rounded bg-muted px-1.5 py-0.5 text-[0.9em]">{node.v}</code>
          case 'br':
            return <br key={i} />
          case 'link': {
            // An external link opens in a new tab and carries noopener, so the page it opens cannot
            // reach back through window.opener. An internal one uses the router.
            const external = isExternalHref(node.href)
            return external ? (
              <a
                key={i}
                href={node.href}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
                className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
              >
                <Inline nodes={node.c} />
              </a>
            ) : (
              <Link
                key={i}
                href={node.href}
                className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
              >
                <Inline nodes={node.c} />
              </Link>
            )
          }
          default:
            return null
        }
      })}
    </>
  )
}
