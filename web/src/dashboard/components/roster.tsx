import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Table, TableWrap } from '../../components/ui/table';
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
    <Card className="roster-card">
      <CardHeader>
        <div className="eyebrow">Players</div>
        <div className="roster-heading">
          <div>
            <h2>Connected roster</h2>
            <p>
              Every occupied slot maps to one virtual Xbox-style controller.
            </p>
          </div>
          <span className="capacity">{players.length} / 16 slots</span>
        </div>
      </CardHeader>
      <CardContent>
        {players.length === 0 ? (
          <div className="empty-state">
            <strong>No players connected.</strong>
            <span>Keep this page open while phones scan the join code.</span>
          </div>
        ) : (
          <TableWrap>
            <Table>
              <caption className="sr-only">Connected Airdeck players</caption>
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Player</th>
                  <th>State</th>
                  <th>Last input</th>
                  <th>RTT</th>
                  <th>Layout</th>
                  <th>Device</th>
                  <th>Rumble</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
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
              </tbody>
            </Table>
          </TableWrap>
        )}
      </CardContent>
    </Card>
  );
}
