import 'server-only'

/**
 * Every player a document refers to.
 *
 * ── Why the registry is asked rather than the field names ───────────────────────────────────────
 * "Any config key ending in PlayerId" would work today and quietly stop working the first time
 * somebody names one `holder` or `subject`. The registry already knows which fields are declared
 * `kind: 'player'`, so that is what is read — the same single description of the field that
 * produces its type, its validator and its control. There is no second list to keep in step.
 */

import { getModule } from './registry'
import type { LayoutDocument, ModuleInstance } from './document'

function walk(modules: ModuleInstance[]): ModuleInstance[] {
  return modules.flatMap((m) => [m, ...walk(m.children ?? [])])
}

/** Where a player id sits in a document, so a dangling one can be pointed at rather than counted. */
export interface PlayerRef {
  moduleId: string
  moduleType: string
  field: string
  playerId: string
}

export function playerRefsIn(document: LayoutDocument): PlayerRef[] {
  const refs: PlayerRef[] = []
  // Named `mod`, not `module`: Next forbids assigning to `module`, which is a CommonJS global.
  for (const mod of walk(document.sections?.flatMap((s) => s.modules ?? []) ?? [])) {
    const def = getModule(mod.type)
    if (!def) continue
    for (const [key, field] of Object.entries(def.fields)) {
      if (field.kind !== 'player') continue
      const value = mod.config?.[key]
      if (typeof value !== 'string' || value.trim() === '') continue
      refs.push({ moduleId: mod.id, moduleType: mod.type, field: key, playerId: value.trim() })
    }
  }
  return refs
}
