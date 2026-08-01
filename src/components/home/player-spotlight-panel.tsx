import { Panel, Flag, PlayerAvatar } from '@/components/home/primitives'
import type { SpotlightPlayer } from '@/lib/home/fixtures'

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-2 py-2 text-center">
      <p className="tabular text-lg font-bold leading-none text-gold">{value}</p>
      <p className="eyebrow mt-1 text-[0.5rem] text-muted-foreground">{label}</p>
    </div>
  )
}

export function PlayerSpotlightPanel({ player }: { player: SpotlightPlayer }) {
  return (
    <Panel title="Player Spotlight" actionLabel="View profile" actionHref={player.href} bodyClassName="p-0">
      <div className="flex flex-col items-center px-4 pt-4">
        <PlayerAvatar name={player.name} size="xl" />
        <p className="mt-2 flex items-center gap-1.5 text-base font-semibold text-foreground">
          {player.name} <Flag code={player.country} />
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 p-4">
        <Stat value={String(player.seasonTitles)} label="Season Titles" />
        <Stat value={String(player.cupTitles)} label="Cup Titles" />
        <Stat value={player.record} label="Season Record" />
        <Stat value={`#${player.currentRank}`} label="Current Rank" />
        <Stat value={`#${player.highestRank}`} label="Highest Rank" />
        <Stat value={String(player.memberSince)} label="Member Since" />
      </div>
    </Panel>
  )
}
