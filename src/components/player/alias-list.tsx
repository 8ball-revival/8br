import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { AtSign } from 'lucide-react'
import type { PreviewAlias } from '@/lib/preview-players'

const TYPE_LABEL: Record<string, string> = {
  handle: 'Handle',
  ym: 'YM',
  yahoo_messenger: 'YM',
  email: 'Email',
  forum: 'Forum',
}

function typeLabel(t: string) {
  return TYPE_LABEL[t.toLowerCase()] ?? t
}

/** All known aliases for a canonical player, grouped visually by chip. */
export function AliasList({
  aliases,
  primaryName,
}: {
  aliases: PreviewAlias[]
  primaryName: string
}) {
  if (aliases.length === 0) {
    return (
      <EmptyState
        icon={AtSign}
        title="Aliases pending verification"
        description="Known aliases for this identity will appear here."
      />
    )
  }
  return (
    <div className="flex flex-wrap gap-2">
      {aliases.map((a, i) => {
        const isPrimary = a.alias === primaryName
        return (
          <span
            key={`${a.alias}-${a.type}-${i}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-sm"
          >
            <span className={isPrimary ? 'font-semibold' : ''}>{a.alias}</span>
            {isPrimary ? (
              <Badge variant="gold">Primary</Badge>
            ) : (
              <span className="text-xs text-muted-foreground">{typeLabel(a.type)}</span>
            )}
          </span>
        )
      })}
    </div>
  )
}
