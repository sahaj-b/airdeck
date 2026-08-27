import { UserX } from 'lucide-react';
import { memo, useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { TableCell, TableRow } from '../../components/ui/table';
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
      // store surfaces the error banner
    } finally {
      setBusy(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="font-mono text-xs font-bold text-primary">
        P{player.slot + 1}
      </TableCell>

      <TableCell>
        <div className="grid gap-0.5">
          <span
            className="text-sm font-medium leading-none"
            style={{ color: player.accent }}
          >
            {player.name}
          </span>
          {player.name !== player.fallbackName && (
            <span className="max-w-[140px] truncate text-[11px] leading-none text-muted-foreground">
              {player.fallbackName}
            </span>
          )}
        </div>
      </TableCell>

      <TableCell>
        <Badge className={stateClass(player.state)} variant="secondary">
          {player.state}
        </Badge>
      </TableCell>

      <TableCell className="tabular-nums text-xs text-muted-foreground">
        {formatAge(player.lastInput, now)}
      </TableCell>

      <TableCell className="tabular-nums text-xs">
        {formatRTT(player.rttNanos)}
      </TableCell>

      <TableCell>
        <Select
          value={player.layoutId}
          disabled={busy || player.state === 'closed'}
          onValueChange={(value) => {
            if (value == null) return;
            void run(() => onLayout(player.id, value));
          }}
        >
          <SelectTrigger size="sm" className="h-7 w-[130px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {layouts.map((layout) => (
              <SelectItem key={layout.id} value={layout.id}>
                {layout.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>

      <TableCell>
        <div className="grid gap-0.5">
          <span
            className={`text-xs font-medium leading-none ${deviceColor(player.deviceStatus)}`}
          >
            {player.deviceStatus || 'unknown'}
          </span>
          {player.deviceReason && (
            <span className="max-w-[170px] truncate text-[11px] text-muted-foreground">
              {player.deviceReason}
            </span>
          )}
        </div>
      </TableCell>

      <TableCell>
        <div className="flex items-center gap-1.5">
          <Select
            value=""
            disabled={busy || player.state === 'closed'}
            onValueChange={(value) => {
              if (value == null) return;
              const target = Number(value);
              if (!Number.isNaN(target))
                void run(() => onMove(player.id, target));
            }}
          >
            <SelectTrigger size="sm" className="h-7 w-[88px] text-xs">
              <SelectValue placeholder="Move…" />
            </SelectTrigger>
            <SelectContent>
              {freeSlots.map((slot) => (
                <SelectItem
                  key={slot}
                  value={String(slot)}
                  disabled={slot === player.slot}
                >
                  P{slot + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            title="Kick player"
            aria-label="Kick player"
            disabled={busy}
            onClick={() => void run(() => onKick(player.id))}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          >
            <UserX className="size-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
});

function stateClass(state: PlayerSnapshot['state']): string {
  switch (state) {
    case 'active':
      return 'border-emerald-500/20 bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
    case 'stale':
      return 'border-amber-500/20 bg-amber-500/15 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
    case 'device-error':
      return 'border-destructive/20 bg-destructive/10 text-destructive';
    case 'disconnected-grace':
      return 'bg-muted text-muted-foreground border-transparent';
    default:
      return '';
  }
}

function deviceColor(status: string): string {
  if (status === 'ready') return 'text-emerald-600 dark:text-emerald-400';
  if (status === 'error') return 'text-destructive';
  return 'text-muted-foreground';
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
  if (!Number.isFinite(nanos) || nanos <= 0) return '—';
  const milliseconds = Math.round(nanos / 1_000_000);
  return `${String(milliseconds).padStart(2)}ms`;
}
