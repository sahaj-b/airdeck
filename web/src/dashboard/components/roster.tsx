import { Badge } from '../../components/ui/badge';
import {
  Card,
  CardContent,
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
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg">Players</CardTitle>
          <Badge variant="secondary" className="tabular-nums">
            {players.length} / 16
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {players.length === 0 ? (
          <div className="grid gap-1 rounded-lg border border-dashed p-8 text-center">
            <div className="text-sm font-medium">No players connected.</div>
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
