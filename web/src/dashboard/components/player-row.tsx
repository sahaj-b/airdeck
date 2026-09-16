import { ArrowRightLeft, Unplug } from 'lucide-react';
import { useState } from 'react';
import {
  LayoutMiniPreview,
  LayoutMiniSkeleton,
} from '../../components/layout-mini-preview';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import {
  type LayoutSummary,
  MAX_PLAYERS,
  type PlayerSnapshot,
} from '../../shared/contracts';
import type { LayoutDocument } from '../../shared/layout';

interface PlayerRowProps {
  player: PlayerSnapshot;
  players: PlayerSnapshot[];
  layouts: LayoutSummary[];
  layoutDocs: Map<string, LayoutDocument>;
  now: number;
  onKick: (id: string) => Promise<void>;
  onMove: (id: string, slot: number) => Promise<void>;
  onLayout: (id: string, layoutId: string) => Promise<void>;
}

export function PlayerRow({
  player,
  players,
  layouts,
  layoutDocs,
  now,
  onKick,
  onMove,
  onLayout,
}: PlayerRowProps) {
  const [busy, setBusy] = useState(false);
  const freeSlots = Array.from(
    { length: MAX_PLAYERS },
    (_, slot) => slot,
  ).filter(
    (slot) => slot === player.slot || !players.some((c) => c.slot === slot),
  );

  function run(action: () => Promise<void>): void {
    setBusy(true);
    void action()
      .catch(() => {
        // store surfaces the error banner
      })
      .finally(() => {
        setBusy(false);
      });
  }

  const age = formatAge(player.lastInput, now);
  const rtt = formatRTT(player.rttNanos);
  const hasRTT = Number.isFinite(player.rttNanos) && player.rttNanos > 0;
  const accent = player.accent || 'oklch(0.65 0.12 260)';

  return (
    <div
      className={`group flex flex-col gap-3 bg-transparent px-3 py-3 transition-colors sm:px-4 ${busy ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-start gap-3 sm:gap-3.5">
        <div
          className="grid size-11 shrink-0 place-items-center rounded-xl border text-sm font-bold tracking-tight tabular-nums sm:size-[44px]"
          style={{
            backgroundColor: `color-mix(in oklch, ${accent} 10%, transparent)`,
            color: accent,
            borderColor: `color-mix(in oklch, ${accent} 22%, transparent)`,
          }}
          role="img"
          aria-label={`Slot ${player.slot + 1}`}
        >
          P{player.slot + 1}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="truncate text-[15px] font-semibold leading-none tracking-tight"
              style={{ color: accent }}
            >
              {player.name}
            </span>
            <Badge
              className={`${stateClass(player.state)} rounded-full px-2 py-0 text-[11px] font-medium leading-none`}
              variant="secondary"
            >
              {labelForState(player.state)}
            </Badge>
            {/* Transport badge: relayed and direct both render; unknown
                (connecting, LAN socket, gone) renders pending instead of
                lying with direct. */}
            {player.relayState === 'relayed' || player.relayed ? (
              <Badge
                className="rounded-full border-sky-500/20 bg-sky-500/10 px-2 py-0 text-[11px] font-medium leading-none text-sky-700 dark:text-sky-300"
                variant="secondary"
                title="Joined over the online relay"
              >
                relay
              </Badge>
            ) : player.relayState === 'direct' ? (
              <Badge
                className="rounded-full border-emerald-500/20 bg-emerald-500/10 px-2 py-0 text-[11px] font-medium leading-none text-emerald-700 dark:text-emerald-300"
                variant="secondary"
                title="Direct peer-to-peer connection"
              >
                direct
              </Badge>
            ) : player.relayState === 'unknown' ? (
              <Badge
                className="rounded-full border-border bg-muted px-2 py-0 text-[11px] font-medium leading-none text-muted-foreground"
                variant="secondary"
                title="Transport not determined yet"
              >
                …
              </Badge>
            ) : null}
            {player.graceDeadline && player.state === 'disconnected-grace' && (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                until {formatTime(player.graceDeadline)}
              </span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-none">
            <Tooltip>
              <TooltipTrigger style={{ cursor: 'default' }}>
                <span
                  className={`tabular-nums ${hasRTT ? 'font-semibold tracking-tight text-foreground' : 'font-medium text-muted-foreground'}`}
                >
                  {rtt}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">RTT / Ping</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger style={{ cursor: 'default' }}>
                <span className="tabular-nums text-muted-foreground">
                  {age}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">Last input</TooltipContent>
            </Tooltip>
            {player.state === 'device-error' && (
              <span className="hidden font-medium sm:inline text-destructive">
                error
              </span>
            )}
          </div>

          {player.deviceReason && (
            <div className="mt-1 max-w-[32ch] truncate text-[11px] leading-none text-muted-foreground sm:max-w-none">
              {player.deviceReason}
            </div>
          )}

          {player.state === 'device-error' && (
            <div className="mt-1 text-xs leading-none sm:hidden">
              <span className="font-medium text-destructive">error</span>
            </div>
          )}
        </div>

        {/* Single controls block: full-width on mobile (aligned under name), inline on desktop */}
        <div className="flex w-full items-center gap-2 pl-[52px] sm:pl-[56px] lg:ml-auto lg:w-auto lg:pl-0">
          <Select
            value={player.layoutId}
            disabled={busy}
            onValueChange={(value) => {
              if (value == null) return;
              void run(() => onLayout(player.id, value));
            }}
          >
            <SelectTrigger
              size="sm"
              className="h-8 flex-1 rounded-full bg-background text-xs sm:flex-none sm:w-[148px] lg:w-[132px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="w-[260px]">
              {layouts.map((layout) => {
                const doc = layoutDocs.get(layout.id);
                return (
                  <SelectItem key={layout.id} value={layout.id}>
                    <span className="flex w-full min-w-0 items-center gap-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {layout.name}
                      </span>
                      <span className="w-16 shrink-0">
                        {doc ? (
                          <LayoutMiniPreview doc={doc} />
                        ) : (
                          <LayoutMiniSkeleton />
                        )}
                      </span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <Select
            value=""
            disabled={busy}
            onValueChange={(value) => {
              if (value == null) return;
              const target = Number(value);
              if (!Number.isNaN(target))
                void run(() => onMove(player.id, target));
            }}
          >
            <SelectTrigger
              size="sm"
              className="h-8 w-[96px] shrink-0 rounded-full bg-background text-xs"
            >
              <span className="flex items-center gap-1">
                <ArrowRightLeft className="size-3 opacity-60 lg:hidden" />
                <SelectValue placeholder="Move" />
              </span>
            </SelectTrigger>
            <SelectContent>
              {freeSlots.map((slot) => (
                <SelectItem
                  key={slot}
                  value={String(slot)}
                  disabled={slot === player.slot}
                >
                  P{slot + 1}
                  {slot === player.slot ? ' • current' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Tooltip>
            <TooltipTrigger>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Kick ${player.name}`}
                disabled={busy}
                onClick={() => void run(() => onKick(player.id))}
                className="ml-auto shrink-0 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:ml-1 lg:ml-0"
              >
                <Unplug className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Kick player</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function labelForState(state: PlayerSnapshot['state']): string {
  switch (state) {
    case 'active':
      return 'active';
    case 'stale':
      return 'idle';
    case 'device-error':
      return 'device error';
    case 'disconnected-grace':
      return 'reconnecting';
    default:
      return state;
  }
}

function stateClass(state: PlayerSnapshot['state']): string {
  switch (state) {
    case 'active':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 'stale':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300';
    case 'device-error':
      return 'border-destructive/20 bg-destructive/10 text-destructive';
    case 'disconnected-grace':
      return 'border-border bg-muted text-muted-foreground';
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
}

function formatAge(value: string, now: number): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'no input yet';
  const age = Math.max(0, now - timestamp);
  if (age < 1000) return 'just now';
  if (age < 60_000) return `${Math.floor(age / 1000)}s ago`;
  return `${Math.floor(age / 60_000)}m ago`;
}

function formatRTT(nanos: number): string {
  if (!Number.isFinite(nanos) || nanos <= 0) return '-';
  const ms = Math.round(nanos / 1_000_000);
  return `${String(ms)}ms`;
}

function formatTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
