import fs from 'node:fs'

/** Minimal RFC4180-ish CSV parser (handles quotes, escaped quotes, commas, CRLF). */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // strip BOM
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (c === '\r') {
      i++
      continue
    }
    if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += c
    i++
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * Read a CSV file into row objects keyed by header. Each object includes a
 * `__row` (1-based file line of the data row) for source provenance. READ-ONLY.
 */
export function readCsvObjects(filePath) {
  const text = fs.readFileSync(filePath, 'utf8')
  const raw = parseCsv(text).filter((r) => !(r.length === 1 && r[0] === ''))
  if (raw.length === 0) return { header: [], rows: [] }
  const header = raw[0]
  const rows = raw.slice(1).map((r, idx) => {
    const o = { __row: idx + 2 }
    header.forEach((h, j) => {
      o[h] = r[j] ?? ''
    })
    return o
  })
  return { header, rows }
}
