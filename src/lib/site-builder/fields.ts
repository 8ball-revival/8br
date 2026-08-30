/**
 * The field kernel: one description of a module option that produces four things.
 *
 * ── Why this is written here rather than reached for from a package ──────────────────────────────
 * This project carries twenty runtime dependencies and no schema library. Adding one would have
 * given a type and a validator, and the inspector would then have needed a SECOND description of the
 * same field — which control to draw, what to label it, what the range is. Two descriptions of one
 * field drift, and they drift silently: the inspector keeps offering a value the server has started
 * rejecting, and the only symptom is a save that fails for no visible reason.
 *
 * So a descriptor here yields all four at once:
 *
 *   1. the TypeScript type            (via `Infer`)
 *   2. the server-side validator      (via `validateConfig`)
 *   3. the default value              (via `defaultsFor`)
 *   4. the inspector control          (the descriptor IS the UI spec — kind, label, options, range)
 *
 * Add a field once and the editor can edit it, the server will accept it, and the type checker knows
 * about it. There is no second place to update.
 *
 * ── What it deliberately does not do ─────────────────────────────────────────────────────────────
 * It is not a general-purpose schema language. There are no unions of objects, no recursion, no
 * refinement chains. Every value a module stores is a scalar, an enum, a small record or a list of
 * those, because that is the whole surface a visual inspector can actually present. Keeping the
 * kernel small is what keeps `validateConfig` short enough to be obviously correct — and this
 * function is the boundary that stops a malformed draft reaching the database.
 */

import { isSafeUrl } from './urls'

// ── Descriptors ─────────────────────────────────────────────────────────────────────────────────

interface Base {
  /** Inspector label. */
  label: string
  /** Longer explanation, shown under the control for options whose effect is not obvious. */
  help?: string
  /** Group heading in the inspector, so related controls sit together. */
  group?: string
  /** Hide unless another field has one of these values, e.g. `{ field: 'mode', in: ['image'] }`. */
  showWhen?: { field: string; in: (string | number | boolean)[] }
}

export type Field =
  | (Base & { kind: 'text'; default: string; maxLength?: number; multiline?: boolean; placeholder?: string })
  | (Base & { kind: 'richText'; default: string; maxLength?: number })
  | (Base & { kind: 'number'; default: number; min?: number; max?: number; step?: number; unit?: string })
  | (Base & { kind: 'boolean'; default: boolean })
  | (Base & { kind: 'select'; default: string; options: { value: string; label: string }[] })
  | (Base & { kind: 'multiSelect'; default: string[]; options: { value: string; label: string }[] })
  | (Base & { kind: 'color'; default: string })
  | (Base & { kind: 'media'; default: number | null })
  | (Base & { kind: 'url'; default: string; internalOnly?: boolean })
  | (Base & { kind: 'list'; default: unknown[]; of: FieldSet; max?: number; itemLabel?: string })

export type FieldSet = Record<string, Field>

/** The config object a `FieldSet` describes. */
export type Infer<F extends FieldSet> = { [K in keyof F]: InferField<F[K]> }

type InferField<F extends Field> =
  F extends { kind: 'text' | 'richText' | 'select' | 'color' | 'url' } ? string
  : F extends { kind: 'number' } ? number
  : F extends { kind: 'boolean' } ? boolean
  : F extends { kind: 'multiSelect' } ? string[]
  : F extends { kind: 'media' } ? number | null
  : F extends { kind: 'list'; of: infer S } ? (S extends FieldSet ? Infer<S>[] : never)
  : never

// ── Defaults ────────────────────────────────────────────────────────────────────────────────────

/** The starting config for a freshly inserted module. */
export function defaultsFor<F extends FieldSet>(fields: F): Infer<F> {
  const out: Record<string, unknown> = {}
  for (const [key, f] of Object.entries(fields)) {
    // Cloned, not shared. A default array or record handed out by reference would be mutated by the
    // first module that edited it, and every module inserted afterwards would inherit the change.
    out[key] = f.kind === 'list' || f.kind === 'multiSelect'
      ? structuredClone(f.default)
      : f.default
  }
  return out as Infer<F>
}

// ── Validation ──────────────────────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  /** Dotted path, e.g. `panels.0.ctaHref`. */
  path: string
  message: string
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] }

/**
 * Validate and COERCE an untrusted config against a field set.
 *
 * Coercing rather than only checking matters for two real cases: a number arriving as a string from
 * a form control, and a field that did not exist when the config was written. Both are ordinary, and
 * neither should be an error the administrator has to decode — the first is corrected, the second
 * takes its default. Anything that cannot be honestly coerced is reported with its path.
 *
 * Unknown keys are DROPPED rather than rejected. A config written by a newer version of a module and
 * then rolled back would otherwise be unopenable, and dropping is what makes an old revision safe to
 * restore. Nothing is preserved that the current schema cannot describe, which is also what stops an
 * imported document smuggling a key past the registry.
 */
export function validateConfig<F extends FieldSet>(
  fields: F,
  input: unknown,
  basePath = '',
): ValidationResult<Infer<F>> {
  const issues: ValidationIssue[] = []
  const source = (input && typeof input === 'object' && !Array.isArray(input))
    ? input as Record<string, unknown>
    : {}
  const out: Record<string, unknown> = {}

  for (const [key, f] of Object.entries(fields)) {
    const path = basePath ? `${basePath}.${key}` : key
    const raw = source[key]
    if (raw === undefined || raw === null) {
      out[key] = f.kind === 'list' || f.kind === 'multiSelect' ? structuredClone(f.default) : f.default
      continue
    }
    const r = validateField(f, raw, path)
    if (r.ok) out[key] = r.value
    else issues.push(...r.issues)
  }

  return issues.length ? { ok: false, issues } : { ok: true, value: out as Infer<F> }
}

function validateField(f: Field, raw: unknown, path: string): ValidationResult<unknown> {
  const fail = (message: string): ValidationResult<unknown> => ({ ok: false, issues: [{ path, message }] })

  switch (f.kind) {
    case 'text':
    case 'richText': {
      if (typeof raw !== 'string') return fail('Expected text.')
      // Rich text is sanitised at the boundary, never trusted from the client. Plain text has any
      // angle brackets stripped so a value that is only ever printed cannot become markup.
      const cleaned = f.kind === 'richText' ? sanitiseRichText(raw) : raw.replace(/[<>]/g, '')
      const max = f.maxLength ?? (f.kind === 'richText' ? 20000 : 2000)
      if (cleaned.length > max) return fail(`Too long (limit ${max} characters).`)
      return { ok: true, value: cleaned }
    }

    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(n)) return fail('Expected a number.')
      if (f.min !== undefined && n < f.min) return fail(`Must be at least ${f.min}.`)
      if (f.max !== undefined && n > f.max) return fail(`Must be at most ${f.max}.`)
      return { ok: true, value: n }
    }

    case 'boolean':
      return { ok: true, value: raw === true || raw === 'true' }

    case 'select': {
      const v = String(raw)
      if (!f.options.some((o) => o.value === v)) return fail(`"${v}" is not one of the allowed values.`)
      return { ok: true, value: v }
    }

    case 'multiSelect': {
      if (!Array.isArray(raw)) return fail('Expected a list.')
      const allowed = new Set(f.options.map((o) => o.value))
      const picked = raw.map(String).filter((v) => allowed.has(v))
      return { ok: true, value: picked }
    }

    case 'color': {
      const v = String(raw).trim()
      // Hex, or a reference to an existing design token. Anything else — a raw rgb(), a gradient, a
      // url() — is a place arbitrary CSS could be smuggled in, so the allowed shapes are explicit.
      if (!/^#[0-9a-fA-F]{3,8}$/.test(v) && !/^var\(--[a-z0-9-]+\)$/.test(v)) {
        return fail('Expected a hex colour or a design token.')
      }
      return { ok: true, value: v }
    }

    case 'media': {
      if (raw === '' ) return { ok: true, value: null }
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isInteger(n) || n <= 0) return fail('Expected a media item.')
      return { ok: true, value: n }
    }

    case 'url': {
      const v = String(raw).trim()
      if (v === '') return { ok: true, value: '' }
      if (!isSafeUrl(v, { internalOnly: f.internalOnly })) {
        return fail(f.internalOnly ? 'Expected a path on this site.' : 'That link is not allowed.')
      }
      return { ok: true, value: v }
    }

    case 'list': {
      if (!Array.isArray(raw)) return fail('Expected a list.')
      if (f.max !== undefined && raw.length > f.max) return fail(`At most ${f.max} items.`)
      const issues: ValidationIssue[] = []
      const items: unknown[] = []
      raw.forEach((item, i) => {
        const r = validateConfig(f.of, item, `${path}.${i}`)
        if (r.ok) items.push(r.value)
        else issues.push(...r.issues)
      })
      return issues.length ? { ok: false, issues } : { ok: true, value: items }
    }
  }
}

// ── Rich text ───────────────────────────────────────────────────────────────────────────────────

/**
 * The only markup an administrator can store, and the only markup that will ever be rendered.
 *
 * An allowlist rather than a blocklist: a blocklist has to anticipate every dangerous construct,
 * and the ones that matter are the ones nobody anticipated. Everything not named here is removed,
 * so a tag added to HTML next year is excluded by default rather than by an update.
 *
 * `<a>` keeps only href, and only an href that survives `isSafeUrl` — which is what keeps
 * `javascript:` out. No element keeps an event handler, a style attribute, or an id.
 */
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li', 'h3', 'h4', 'blockquote', 'code'])

export function sanitiseRichText(html: string): string {
  // Drop whole dangerous elements INCLUDING their content. Stripping only the tags would leave the
  // body of a <script> behind as text that a later innerHTML could revive.
  let out = html.replace(/<(script|style|iframe|object|embed|form|svg|math)\b[\s\S]*?<\/\1\s*>/gi, '')
  out = out.replace(/<(script|style|iframe|object|embed|form|svg|math)\b[^>]*\/?>/gi, '')

  out = out.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (_m, rawName: string, attrs: string) => {
    const name = rawName.toLowerCase()
    if (!ALLOWED_TAGS.has(name)) return ''
    const closing = /^<\//.test(_m)
    if (closing) return `</${name}>`
    if (name === 'a') {
      const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs)
      const value = (href?.[2] ?? href?.[3] ?? '').trim()
      if (!value || !isSafeUrl(value)) return '<a>'
      const external = /^https?:/i.test(value)
      // rel is forced on, not offered: a new-tab link without noopener hands the opener to the
      // destination, and that is not a decision to leave to whoever pasted the URL.
      return external
        ? `<a href="${escapeAttr(value)}" target="_blank" rel="noopener noreferrer">`
        : `<a href="${escapeAttr(value)}">`
    }
    return `<${name}>`
  })

  return out.trim()
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
