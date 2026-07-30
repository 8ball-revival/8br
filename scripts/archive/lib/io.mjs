import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(here, '../../..')

// READ-ONLY source (never written). Overridable for other machines.
export const SOURCE_DIR =
  process.env.ARCHIVE_SOURCE_DIR ||
  'C:/Users/Cerebro/Documents/Cueverse Prime/archive_viewer/data/csv'
export const CORRECTIONS_DIR =
  process.env.ARCHIVE_CORRECTIONS_DIR ||
  'C:/Users/Cerebro/Documents/Cueverse Prime/archive_viewer/corrections'

export const STAGING_DIR = path.join(REPO_ROOT, 'data', 'staging')
export const REPORTS_DIR = path.join(REPO_ROOT, 'reports', 'archive')

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

/** Deterministic JSON write (stable 2-space; arrays are pre-sorted by callers). */
export function writeJson(dir, name, data) {
  ensureDir(dir)
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2) + '\n', 'utf8')
}

export function readJson(dir, name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
}

export function writeText(dir, name, text) {
  ensureDir(dir)
  fs.writeFileSync(path.join(dir, name), text, 'utf8')
}

export function fileExists(p) {
  return fs.existsSync(p)
}

/** Sort an array of objects by a key, stably and deterministically. */
export function byId(arr, key = 'stagingId') {
  return [...arr].sort((a, b) => String(a[key]).localeCompare(String(b[key]), 'en'))
}
