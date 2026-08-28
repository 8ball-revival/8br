import type { PrismaClient } from '@prisma/client'

import { assertPreviewIsolation } from '@/lib/db-guard'

/**
 * Prisma client, loaded LAZILY via dynamic import and exposed through a proxy.
 *
 * Why not `import { PrismaClient } from '@prisma/client'`: the generated Prisma
 * client statically imports `node:fs` and calls `fs.existsSync`. A static `fs`
 * import + `fs.X()` call anywhere in a page's static import graph makes the
 * Turbopack production build emit those pages as ES modules. Vercel then runs each
 * App Router server function through a CommonJS launcher (`___next_launcher.cjs`)
 * that `require()`s the page bundle and fails with `ERR_REQUIRE_ESM`. (Reproduces
 * only on Vercel's Linux Turbopack build, not local Windows builds.)
 * See Next.js discussion #91663.
 *
 * `import type` is erased at compile time (no runtime import), and
 * `await import('@prisma/client')` is dynamic (its own chunk) — so `@prisma/client`
 * (and its `fs` usage) is NOT in any page's static graph, and pages compile to CJS.
 *
 * The exported `prisma` is a Proxy: `prisma.model.method(...)` and `prisma.$xxx(...)`
 * resolve the client on first use and return a Promise (works with `await`).
 * `prisma.$transaction(cb)` receives the real transaction client. NOTE: the
 * array/batch form `prisma.$transaction([...])` is NOT supported through the proxy
 * (its elements would already be executing) — use the interactive `(tx) => …` form.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
  prismaPromise?: Promise<PrismaClient>
}

/** Resolve the singleton client, loading `@prisma/client` on first use. */
export function getPrisma(): Promise<PrismaClient> {
  if (globalForPrisma.prisma) return Promise.resolve(globalForPrisma.prisma)
  if (!globalForPrisma.prismaPromise) {
    /*
     * Checked here because this is the one place every database access passes through, so a preview
     * wired to production fails on its first query rather than after somebody notices live data on a
     * preview URL. It is a no-op everywhere except a Vercel preview.
     */
    assertPreviewIsolation()
    globalForPrisma.prismaPromise = import('@prisma/client').then(({ PrismaClient }) => {
      const client = new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
      })
      globalForPrisma.prisma = client
      return client
    })
  }
  return globalForPrisma.prismaPromise
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (typeof prop === 'symbol' || prop === 'then' || prop === 'catch' || prop === 'finally') {
      return undefined
    }
    // Client-level methods ($transaction, $connect, $queryRaw, …).
    if (prop.startsWith('$')) {
      return (...args: any[]) => getPrisma().then((c) => (c as any)[prop](...args))
    }
    // Model delegates (prisma.tournament.findFirst, …).
    return new Proxy(
      {},
      {
        get(_m, method) {
          return (...args: any[]) => getPrisma().then((c) => (c as any)[prop][method](...args))
        },
      },
    )
  },
}) as PrismaClient
/* eslint-enable @typescript-eslint/no-explicit-any */
