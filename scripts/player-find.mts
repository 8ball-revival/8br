/**
 * Find a player's id from anything you can remember about them.
 *
 * The Site Builder picker means an id is rarely needed by hand any more, but a script debugging a
 * stored config, a support question or a database check still starts with "who is this cuid, and
 * what is Derrick's?". This answers both without opening a SQL client.
 *
 * Reads. It never writes, and it points at the local replica by default — never production.
 *
 *   npm run player:find -- derrick
 *   npm run player:find -- sixohtwo
 *   npm run player:find -- cmsyrx31g00006riggac6o23n
 */

import { readFileSync } from 'node:fs'

const env: Record<string, string> = {}
for (const raw of readFileSync('.env.replica', 'utf8').split(String.fromCharCode(10))) {
  const line = raw.trim(); const eq = line.indexOf('=')
  if (eq < 1 || line.startsWith('#')) continue
  let v = line.slice(eq + 1).trim()
  if (v.length > 1 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1)
  env[line.slice(0, eq).trim()] = v
}
/*
  The replica is the DEFAULT, not the only option, and it does not override an explicit choice.
  Someone who has deliberately set DATABASE_URL gets what they set; everyone else gets the local
  copy rather than whatever happened to be exported.
*/
process.env.DATABASE_URL ||= env.DATABASE_URL ?? ''
process.env.DIRECT_URL ||= env.DIRECT_URL ?? process.env.DATABASE_URL ?? ''

const term = process.argv.slice(2).join(' ').trim()
if (!term) {
  console.error('Usage: npm run player:find -- <name, CueVerse ID, alias or player id>')
  process.exit(2)
}

const { prisma } = await import('../src/lib/prisma')
const { searchPlayers, resolvePlayer } = await import('../src/lib/players/picker-search')

const line = (label: string, value: string) => `  ${label.padEnd(15)}${value}`

try {
  // A cuid is almost certainly an id somebody is trying to identify, so look that up directly first.
  if (/^c[a-z0-9]{20,30}$/.test(term)) {
    const found = await resolvePlayer(term)
    if (!found) {
      console.log(`\nNo player has the id ${term}.`)
      console.log('A stored reference to it will fall back to whatever name is configured beside it.\n')
    } else {
      console.log(`\n${found.name}`)
      console.log(line('id', found.id))
      console.log(line('CueVerse ID', found.cueverseId || '(none)'))
      if (found.aliases.length) console.log(line('also known as', found.aliases.join(', ')))
      if (!found.active) console.log(line('status', 'archived'))
      console.log()
    }
  } else {
    const results = await searchPlayers(term, 20)
    if (results.length === 0) {
      console.log(`\nNothing matches "${term}".`)
      console.log('Names, CueVerse IDs, recorded aliases and merged-away identities were all searched.\n')
    } else {
      console.log(`\n${results.length} match${results.length === 1 ? '' : 'es'} for "${term}":\n`)
      for (const p of results) {
        console.log(`${p.name}${p.active ? '' : '  (archived)'}`)
        console.log(line('id', p.id))
        console.log(line('CueVerse ID', p.cueverseId || '(none)'))
        if (p.aliases.length) console.log(line('also known as', p.aliases.join(', ')))
        if (p.matchedOn === 'alias' && p.matchedValue) console.log(line('matched', `the old handle "${p.matchedValue}"`))
        if (p.matchedOn === 'merged') console.log(line('matched', 'an account merged into this one'))
        console.log()
      }
    }
  }
} finally {
  await prisma.$disconnect()
}

// A moment for the socket to finish closing; exiting into it asserts inside libuv and reports 127.
await new Promise((r) => { setTimeout(r, 250) })
process.exit(0)
