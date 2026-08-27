import { memo, useState } from 'react';
import { Badge, type BadgeProps } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { NativeSelect as Select } from '../../components/ui/native-select';
import type { LayoutSummary, PlayerSnapshot } from '../../shared/contracts';

interface PlayerRowProps {
  player: PlayerSnapshot;
  players: PlayerSnapshot[];
  layouts: LayoutSummary[];
  now: number;
  onKick: (id: string) => Promise<void>;
  onMove: (id: string, slot: number) => Promise<void>;
  onLayout: (id: string, layoutId: string) => Promise<void>;
}

export const PlayerRow = memo(function PlayerRow({
  player,
  players,
  layouts,
  now,
  onKick,
  onMove,
  onLayout,
}: PlayerRowProps) {
  const [busy, setBusy] = useState(false);
  const freeSlots = Array.from({ length: 16 }, (_, slot) => slot).filter(
    (slot) =>
      slot === player.slot ||
      !players.some((candidate) => candidate.slot === slot),
  );

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await action();
    } catch {
      // The store surfaces the error banner; do not let it become an
      // unhandled promise rejection.
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <span className="slot-label">P{player.slot + 1}</span>
      </td>
      <td>
        <div className="player-name-cell">
          <span
            className="accent-swatch"
            style={{ backgroundColor: player.accent }}
            aria-hidden="true"
          />
          <span>
            <strong>{player.name}</strong>
            {player.name !== player.fallbackName && (
              <small>{player.fallbackName}</small>
            )}
          </span>
        </div>
      </td>
      <td>
        <Badge variant={stateVariant(player.state)}>{player.state}</Badge>
      </td>
      <td>{formatAge(player.lastInput, now)}</td>
      <td>{formatRTT(player.rttNanos)}</td>
      <td>
        {layouts.find((layout) => layout.id === player.layoutId)?.name ??
          player.layoutId}
      </td>
      <td>
        <span className={`device-state device-state-${player.deviceStatus}`}>
          {player.deviceStatus || 'unknown'}
        </span>
        {player.deviceReason && (
          <small className="table-detail">{player.deviceReason}</small>
        )}
      </td>
      <td>{player.rumbleCapable ? 'Available' : 'Unavailable'}</td>
      <td>
        <div className="row-actions">
          <Select
            aria-label={`Move ${player.name}`}
            value=""
            disabled={busy || player.state === 'closed'}
            onChange={(event) => {
              const target = Number(event.target.value);
              if (event.target.value !== '')
                void run(() => onMove(player.id, target));
            }}
          >
            <option value="">Move...</option>
            {freeSlots.map((slot) => (
              <option key={slot} value={slot} disabled={slot === player.slot}>
                P{slot + 1}
              </option>
            ))}
          </Select>
          <Select
            aria-label={`Layout for ${player.name}`}
            value={player.layoutId}
            disabled={busy || player.state === 'closed'}
            onChange={(event) =>
              void run(() => onLayout(player.id, event.target.value))
            }
          >
            {layouts.map((layout) => (
              <option key={layout.id} value={layout.id}>
                {layout.name}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => void run(() => onKick(player.id))}
          >
            Kick
          </Button>
        </div>
      </td>
    </tr>
  );
});

function stateVariant(state: PlayerSnapshot['state']): BadgeProps['variant'] {
  switch (state) {
    case 'active':
      return 'success';
    case 'stale':
      return 'warning';
    case 'device-error':
      return 'danger';
    case 'disconnected-grace':
      return 'muted';
    default:
      return 'default';
  }
}

function formatAge(value: string, now: number): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'No input';
  const age = Math.max(0, now - timestamp);
  if (age < 1000) return '<1s';
  if (age < 60_000) return `${Math.floor(age / 1000)}s`;
  return `${Math.floor(age / 60_000)}m`;
}

function formatRTT(nanos: number): string {
  if (!Number.isFinite(nanos) || nanos <= 0) return 'No pong';
  const milliseconds = nanos / 1_000_000;
  return `${milliseconds < 10 ? milliseconds.toFixed(1) : Math.round(milliseconds)}ms`;
}
