import { Fragment, useEffect, useMemo, useState } from 'react';
import { Badge } from '../../components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useLayoutDocs } from '../../components/use-layout-docs';
import {
  type LayoutSummary,
  MAX_PLAYERS,
  type PlayerSnapshot,
} from '../../shared/contracts';
import { PlayerRow } from './player-row';

interface RosterProps {
  players: PlayerSnapshot[];
  layouts: LayoutSummary[];
  onKick: (id: string) => Promise<void>;
  onMove: (id: string, slot: number) => Promise<void>;
  onLayout: (id: string, layoutId: string) => Promise<void>;
}

export function Roster({
  players,
  layouts,
  onKick,
  onMove,
  onLayout,
}: RosterProps) {
  const [now, setNow] = useState(() => Date.now());

  const layoutIds = useMemo(() => layouts.map((l) => l.id), [layouts]);
  const layoutDocs = useLayoutDocs(layoutIds);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg tracking-tight">Players</CardTitle>
          <Badge
            variant="secondary"
            className="inline-flex items-baseline gap-[2px] rounded-full px-2.5 py-1 tabular-nums"
          >
            <span className="text-[13px] font-bold leading-none tracking-tight text-foreground">
              {players.length}
            </span>
            <span className="text-[11px] font-medium leading-none text-muted-foreground/60">
              / {MAX_PLAYERS}
            </span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {players.length === 0 ? (
          <div className="grid gap-1 rounded-xl border border-dashed p-8 text-center">
            <div className="text-sm font-medium">No players connected</div>
          </div>
        ) : (
          <TooltipProvider delay={0}>
            <div className="grid">
              {players.map((player, idx) => (
                <Fragment key={player.id}>
                  <PlayerRow
                    player={player}
                    players={players}
                    layouts={layouts}
                    layoutDocs={layoutDocs}
                    now={now}
                    onKick={onKick}
                    onMove={onMove}
                    onLayout={onLayout}
                  />
                  {idx < players.length - 1 && (
                    <div className="mx-6 h-[2px] rounded-full bg-border" />
                  )}
                </Fragment>
              ))}
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}
