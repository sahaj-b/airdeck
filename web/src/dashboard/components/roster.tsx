import { Badge } from '../../components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import type { LayoutSummary, PlayerSnapshot } from '../../shared/contracts';
import { PlayerRow } from './player-row';

interface RosterProps {
  players: PlayerSnapshot[];
  layouts: LayoutSummary[];
  now: number;
  onKick: (id: string) => Promise<void>;
  onMove: (id: string, slot: number) => Promise<void>;
  onLayout: (id: string, layoutId: string) => Promise<void>;
}

export function Roster({
  players,
  layouts,
  now,
  onKick,
  onMove,
  onLayout,
}: RosterProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardDescription className="text-[11px] font-bold tracking-[0.16em] uppercase">
              Players
            </CardDescription>
            <CardTitle className="mt-1 text-lg">Connected roster</CardTitle>
            <CardDescription className="mt-1">
              Every occupied slot maps to one virtual Xbox-style controller.
            </CardDescription>
          </div>
          <Badge variant="secondary" className="tabular-nums">
            {players.length} / 16 slots
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {players.length === 0 ? (
          <div className="grid gap-1 rounded-lg border border-dashed p-8 text-center">
            <div className="text-sm font-medium">No players connected.</div>
            <div className="text-xs text-muted-foreground">
              Keep this page open while phones scan the join code.
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slot</TableHead>
                <TableHead>Player</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Last input</TableHead>
                <TableHead>RTT</TableHead>
                <TableHead>Layout</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>Rumble</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {players.map((player) => (
                <PlayerRow
                  key={player.id}
                  player={player}
                  players={players}
                  layouts={layouts}
                  now={now}
                  onKick={onKick}
                  onMove={onMove}
                  onLayout={onLayout}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
