/**
 * Arranging a draw saves in order, reconciles from the server, and never refetches the route.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────────────────────────
 * Both placement screens ran `router.refresh()` after every saved swap, refetching the entire
 * Creator page for a board that had already drawn the answer. The server actions ALSO revalidated
 * five or six public paths per drag, and a revalidate inside a Server Action makes the client
 * refresh the current route as part of the reply — so one drag cost two full page loads, and
 * arranging a sixteen-player draw cost dozens.
 *
 * Underneath that were two ordering faults the refreshes had been papering over:
 *
 *   · Each save was fired as an independent transition, so two quick drags could reach the server
 *     in either order and the second answer could describe the first swap.
 *   · Rollback restored a `before` snapshot taken when THAT swap started. With more than one in
 *     flight, `before` predates other swaps that had since succeeded, so a single refusal silently
 *     reversed them too.
 *
 * This exercises the queue directly — it is deliberately a plain module, with no React in it — and
 * then checks the two screens and the two actions for the properties only source can show.
 *
 * Run:  npx tsx --tsconfig tsconfig.scripts.json scripts/verify-placement-refresh.mts
 */
import { readFileSync } from 'node:fs'
import {
  applySwap, createPlacementQueue, type EntrySlot, type PlacementSaveResult, type SlotRef,
} from '../src/lib/seasons/bracket-swap.ts'

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

/*
  Let queued work reach the fake server.

  The queue pumps on a microtask - deliberately, so `enqueue` returns the board to draw without
  waiting on anything - which means a save is issued a tick after the drag, not during it.
*/
const flush = () => new Promise<void>((r) => { setTimeout(r, 0) })

/*
  Source with its comments removed.

  These files EXPLAIN the fault they fix, so `router.refresh()` and `revalidatePath` appear in their
  prose. Searching the raw text would fail on the documentation rather than on the code.
*/
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

// ── A four-seat board: M1 home/away, M2 home/away ───────────────────────────────────────────────
const slot = (matchId: number, side: 'home' | 'away', name: string | null, seed: number): EntrySlot => ({
  matchId, side, section: 'WB', round: 1, slot: matchId, label: null,
  entrantId: name ? name.charCodeAt(0) : null, entrantName: name, seed,
})
const board = (): EntrySlot[] => [
  slot(1, 'home', 'Ann', 1), slot(1, 'away', 'Ben', 4),
  slot(2, 'home', 'Cal', 2), slot(2, 'away', 'Dee', 3),
]
const ref = (matchId: number, side: 'home' | 'away'): SlotRef => ({ matchId, side })
/** Who sits where, in board order — the only thing a reader of the screen can see. */
const seats = (s: readonly EntrySlot[]) => s.map((x) => `${x.matchId}${x.side[0]}:${x.entrantName ?? '-'}`).join(' ')

/** A stand-in server that applies swaps to its own copy and answers only when released. */
function fakeServer(initial: EntrySlot[]) {
  let held = initial.slice()
  const calls: string[] = []
  const gate: (() => void)[] = []
  let refuse: string | null = null
  return {
    calls,
    held: () => held,
    refuseNext: (msg: string) => { refuse = msg },
    /** Let the oldest outstanding save answer. */
    release: () => gate.shift()?.(),
    pending: () => gate.length,
    save(from: SlotRef, to: SlotRef): Promise<PlacementSaveResult> {
      calls.push(`${from.matchId}${from.side[0]}->${to.matchId}${to.side[0]}`)
      const wanted = refuse
      refuse = null
      return new Promise<PlacementSaveResult>((resolve) => {
        gate.push(() => {
          if (wanted) { resolve({ ok: false, error: wanted }); return }
          held = applySwap(held, from, to)
          resolve({ ok: true, slots: held.slice() })
        })
      })
    },
  }
}

function harness(initial = board()) {
  const server = fakeServer(initial.slice())
  const errors: string[] = []
  let drawn = initial.slice()
  const q = createPlacementQueue({
    initial,
    save: (f, t) => server.save(f, t),
    onChange: (s) => { drawn = s },
    onError: (m) => errors.push(m),
  })
  return { q, server, errors, drawn: () => drawn }
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
section('The board moves at once, and every swap is saved')
{
  const h = harness()
  h.q.enqueue(ref(1, 'home'), ref(2, 'away'))
  check('the drawn board changes before the server has answered',
    seats(h.drawn()) === '1h:Dee 1a:Ben 2h:Cal 2a:Ann', seats(h.drawn()))
  await flush()
  check('...and the save was sent', h.server.calls.length === 1, h.server.calls.join(','))

  const before = h.server.calls.length
  h.q.enqueue(ref(1, 'home'), ref(1, 'home'))
  await flush()
  check('a swap onto itself is not sent at all', h.server.calls.length === before)
}

section('Several rapid swaps are saved strictly in order')
{
  const h = harness()
  // Four drags in a row, faster than any one of them can be saved.
  h.q.enqueue(ref(1, 'home'), ref(1, 'away'))   // Ann <-> Ben
  h.q.enqueue(ref(2, 'home'), ref(2, 'away'))   // Cal <-> Dee
  h.q.enqueue(ref(1, 'home'), ref(2, 'home'))   // Ben <-> Dee
  h.q.enqueue(ref(1, 'away'), ref(2, 'away'))   // Ann <-> Cal

  check('the board already shows all four moves, immediately',
    seats(h.drawn()) === '1h:Dee 1a:Cal 2h:Ben 2a:Ann', seats(h.drawn()))
  check('all four are outstanding', h.q.depth() === 4, `${h.q.depth()}`)

  await flush()
  check('only ONE save is in flight at a time', h.server.pending() === 1, `${h.server.pending()}`)
  check('...and only one has been sent so far', h.server.calls.length === 1, h.server.calls.join(','))

  for (let i = 0; i < 4; i += 1) { h.server.release(); await flush() }
  await h.q.settled()

  check('the server received them in the order they were made',
    h.server.calls.join(' ') === '1h->1a 2h->2a 1h->2h 1a->2a', h.server.calls.join(' '))
  check('nothing is left outstanding', h.q.depth() === 0, `${h.q.depth()}`)

  /*
   * The point of the whole exercise: what is drawn equals what was stored. A lost or reversed swap
   * shows up here as a different seating — the bug a refresh-per-swap could hide by overwriting the
   * board from the server a moment later, and could equally cause by landing out of order.
   */
  check('the board matches the record, with nothing lost or reversed',
    seats(h.drawn()) === seats(h.server.held()), `${seats(h.drawn())} vs ${seats(h.server.held())}`)
  check('...and it is the arrangement those four swaps describe',
    seats(h.drawn()) === '1h:Dee 1a:Cal 2h:Ben 2a:Ann', seats(h.drawn()))
}

section('Out-of-order answers cannot arise, because only one question is asked at a time')
{
  const h = harness()
  h.q.enqueue(ref(1, 'home'), ref(1, 'away'))
  h.q.enqueue(ref(1, 'home'), ref(2, 'home'))
  await flush()
  check('the second save has not been sent yet', h.server.calls.length === 1, h.server.calls.join(','))
  h.server.release(); await flush()
  check('it goes out only once the first has settled',
    h.server.calls.length === 2, h.server.calls.join(','))
}

section('The board adopts what the server says, not an echo of the request')
{
  /*
   * Why the actions return the slots. The server does not always perform the exchange the client
   * drew — a swap involving a bye is asked for from the other end, and a seed belongs to the
   * position rather than to the person — so an echo of the request would drift from the record.
   */
  let seen: EntrySlot[] = []
  const q = createPlacementQueue({
    initial: board(),
    save: async () => ({
      ok: true,
      slots: [
        slot(1, 'home', 'Zed', 1), slot(1, 'away', 'Ben', 4),
        slot(2, 'home', 'Cal', 2), slot(2, 'away', 'Dee', 3),
      ],
    }),
    onChange: (s) => { seen = s },
    onError: () => {},
  })
  q.enqueue(ref(1, 'home'), ref(2, 'home'))
  await q.settled()
  check("the server's arrangement wins over the optimistic one",
    seats(seen) === '1h:Zed 1a:Ben 2h:Cal 2a:Dee', seats(seen))
}

section('A refusal restores a board that really existed')
{
  const h = harness()
  h.q.enqueue(ref(1, 'home'), ref(1, 'away'))          // this one succeeds
  await flush(); h.server.release(); await h.q.settled()
  const afterFirst = seats(h.drawn())
  check('the first swap stands', afterFirst === '1h:Ben 1a:Ann 2h:Cal 2a:Dee', afterFirst)

  h.server.refuseNext('That tie already has a result.')
  h.q.enqueue(ref(1, 'home'), ref(2, 'home'))          // this one is refused
  await flush(); h.server.release(); await h.q.settled()

  check('the refused move is undone', seats(h.drawn()) === afterFirst, seats(h.drawn()))
  check('...and the swap that DID save is still there',
    seats(h.drawn()) === seats(h.server.held()), `${seats(h.drawn())} vs ${seats(h.server.held())}`)
  check('the person is told why', h.errors.join('') === 'That tie already has a result.', h.errors.join('|'))
}

section('A refusal under load reverts to the last confirmed board, not a stale snapshot')
{
  /*
   * The fault a single `before` snapshot has. Three drags are queued and the FIRST is refused. The
   * old code restored that swap's own snapshot; the two later swaps, drawn on top of a board that
   * never existed, were left on screen looking saved.
   */
  const h = harness()
  h.server.refuseNext('Not allowed.')
  h.q.enqueue(ref(1, 'home'), ref(1, 'away'))
  h.q.enqueue(ref(2, 'home'), ref(2, 'away'))
  h.q.enqueue(ref(1, 'home'), ref(2, 'home'))
  await flush(); h.server.release(); await h.q.settled()

  check('the board returns to the last arrangement the server confirmed',
    seats(h.drawn()) === seats(board()), seats(h.drawn()))
  check('the swaps drawn on top of the refused one are dropped, not saved',
    h.server.calls.length === 1, h.server.calls.join(','))
  check('nothing is left counted as outstanding', h.q.depth() === 0, `${h.q.depth()}`)
  check('one message, not three', h.errors.length === 1, h.errors.join('|'))
}

section('A save that throws is treated as a refusal, not as success')
{
  let drawn: EntrySlot[] = board()
  const errors: string[] = []
  const q = createPlacementQueue({
    initial: board(),
    save: async () => { throw new Error('network') },
    onChange: (s) => { drawn = s },
    onError: (m) => errors.push(m),
  })
  q.enqueue(ref(1, 'home'), ref(2, 'home'))
  await q.settled()
  check('the board is put back', seats(drawn) === seats(board()), seats(drawn))
  check('and it says so', errors.length === 1, errors.join('|'))
}

section('A fresh server board can be adopted once nothing is outstanding')
{
  const h = harness()
  h.q.enqueue(ref(1, 'home'), ref(1, 'away'))
  await flush(); h.server.release(); await h.q.settled()
  const regenerated = [
    slot(1, 'home', 'Eve', 1), slot(1, 'away', 'Fay', 4),
    slot(2, 'home', 'Gus', 2), slot(2, 'away', 'Hal', 3),
  ]
  h.q.reset(regenerated)
  h.q.enqueue(ref(1, 'home'), ref(2, 'home'))
  check('later swaps are drawn on the new board, not the old one',
    seats(h.drawn()) === '1h:Gus 1a:Fay 2h:Eve 2a:Hal', seats(h.drawn()))
}

// ── The screens ─────────────────────────────────────────────────────────────────────────────────
section('Neither placement screen refreshes the route when a player is moved')
{
  const screens = [
    'src/components/creator/tournament-bracket-setup.tsx',
    'src/components/creator/playoff-workspace.tsx',
  ]
  for (const f of screens) {
    const src = readFileSync(f, 'utf8')
    const name = f.split('/').pop()

    check(`${name} places through the shared queue`, src.includes('usePlacementBoard({'))
    check(`${name} no longer keeps its own pre-swap snapshot`, !/const before = slots/.test(src))

    /*
     * The swap handler specifically. The rest of the screen — generate, draft, start — still
     * refreshes, and should: those change what the page itself renders.
     */
    const at = src.indexOf(f.includes('playoff-workspace') ? 'const commitSwap' : 'const swap = (from')
    const handler = src.slice(at, at + 600)
    check(`${name}'s swap handler does not call router.refresh()`, !handler.includes('router.refresh'))
  }

  const hook = readFileSync('src/components/creator/use-placement-board.ts', 'utf8')
  check('the shared hook never refreshes the route either',
    !/useRouter|router\.refresh/.test(code(hook)))
  check('...and it will not adopt server props on top of unsaved work',
    hook.includes('if (seen !== signature && !saving)'))
}

section('The draft-placement actions do not revalidate, and do return the board')
{
  const t = readFileSync('src/lib/creator/tournament-entrants-actions.ts', 'utf8')
  const s = readFileSync('src/lib/seasons/actions.ts', 'utf8')

  const bodyOf = (src: string, name: string) => {
    const at = src.indexOf(`export async function ${name}`)
    const rest = src.slice(at)
    return rest.slice(0, rest.indexOf('\n}\n') + 3)
  }
  const tAction = bodyOf(t, 'swapTournamentBracketSlotsAction')
  const sAction = bodyOf(s, 'swapSeasonBracketSlotsAction')

  const revalidates = (body: string) => /revalidate/.test(code(body))
  check('the Tournament swap does not revalidate a public path', !revalidates(tAction))
  check('the Season swap does not revalidate a public path', !revalidates(sAction))
  check('the Tournament swap returns the board', /slots: await tournamentEntrySlots/.test(tAction))
  check('the Season swap returns the board', sAction.includes('slots: topo.entrySlots'))

  /*
   * Not revalidating is only safe because neither action can touch a published bracket: a draft
   * board is on no public page. If either guard goes, public pages start serving a stale board and
   * this decision has to be revisited — so the guards are asserted here, next to the reason.
   */
  check('the Tournament swap still refuses anything but a draft bracket',
    tAction.includes('requireTournamentState(tournamentId, DRAFT_BRACKET_STATES)'))
  check('...and that list is draft-only',
    /DRAFT_BRACKET_STATES: TournamentState\[\] = \['REGISTRATION_CLOSED', 'BRACKET_GENERATED'\]/.test(t))
  check('the Season swap still refuses anything but PLAYOFF_SETUP',
    readFileSync('src/lib/seasons/playoffs.ts', 'utf8')
      .includes("if (s?.lifecycleState !== 'PLAYOFF_SETUP') {"))
  check('the Tournament swap still checks the actor',
    tAction.includes('creatorActor()'))
  check('the Season swap still checks the actor',
    sAction.includes("requireCapability('manage_competitions')"))

  // Everything else on these screens is untouched: it changes page data and must still revalidate.
  check('other Tournament actions still revalidate', t.includes('revalidatePath'))
  check('other Season actions still revalidate', s.includes('revalidateSeason(seasonId)'))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
