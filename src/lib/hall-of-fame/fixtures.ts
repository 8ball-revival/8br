/**
 * Compatibility re-export. The Hall of Fame logic moved to `./service` (it is a real
 * archive-derived service, not fixture/mock data — the name was misleading). Existing
 * importers keep working through this shim; new code should import from `./service`.
 */
export * from './service'
