import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import type { PendingJoin } from '../../shared/contracts';

interface ApprovalQueueProps {
  pendings: PendingJoin[];
  onAccept: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

export function ApprovalQueue({
  pendings,
  onAccept,
  onReject,
}: ApprovalQueueProps) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (pendings.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pendings.length]);

  if (pendings.length === 0) return null;

  function run(id: string, action: (id: string) => Promise<void>): void {
    setBusy(id);
    void action(id)
      .catch(() => {
        // store surfaces the error banner
      })
      .finally(() => {
        setBusy((current) => (current === id ? null : current));
      });
  }

  return (
    <Card className="border-amber-500/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg tracking-tight">
          Approval queue{' '}
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            {pendings.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {pendings.map((pending) => (
          <div
            key={pending.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {pending.displayName || 'Player'}
              </div>
              <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                waiting {formatWaiting(pending.waitingSince, now)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy === pending.id}
                onClick={() => run(pending.id, onAccept)}
              >
                Accept
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy === pending.id}
                onClick={() => run(pending.id, onReject)}
              >
                Reject
              </Button>
            </div>
          </div>
        ))}
        <p className="text-xs leading-relaxed text-muted-foreground">
          New joins wait here until you accept them. Cancelled guests vanish on
          their own.
        </p>
      </CardContent>
    </Card>
  );
}

function formatWaiting(since: string, now: number): string {
  const timestamp = Date.parse(since);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'a moment';
  const age = Math.max(0, now - timestamp);
  if (age < 5000) return 'just now';
  if (age < 60_000) return `${Math.floor(age / 1000)}s`;
  const minutes = Math.floor(age / 60_000);
  const seconds = Math.floor((age % 60_000) / 1000);
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}
