import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { AdminStore, useAdminSnapshot } from './admin-store';
import type { SettingsUpdate } from './api';
import { HostPanel } from './components/host-panel';
import { QRCard } from './components/qr-card';
import { Roster } from './components/roster';

const store = new AdminStore();

function Dashboard() {
  const snapshot = useAdminSnapshot(store);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void store.load();
    store.connect();
    return () => store.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const run = useCallback((action: () => Promise<void>): void => {
    void action().catch(() => undefined);
  }, []);
  const onJoinsChange = useCallback(
    (value: boolean) => run(() => store.setAcceptingJoins(value)),
    [run],
  );
  const onNewSession = useCallback(
    () => run(() => store.startNewSession()),
    [run],
  );
  const onSaveSettings = useCallback(
    (update: SettingsUpdate) => run(() => store.saveSettings(update)),
    [run],
  );
  const onKick = useCallback((id: string) => store.kick(id), []);
  const onMove = useCallback(
    (id: string, slot: number) => store.move(id, slot),
    [],
  );
  const onLayout = useCallback(
    (id: string, layoutId: string) => store.setLayout(id, layoutId),
    [],
  );
  const onApplyLayoutToAll = useCallback((layoutId: string) => {
    void store.setAllLayouts(layoutId).catch(() => undefined);
  }, []);

  if (snapshot.loading && !snapshot.state) return <LoadingScreen />;
  if (!snapshot.state)
    return (
      <ErrorScreen
        message={snapshot.error ?? 'The dashboard state is unavailable.'}
        onRetry={() => void store.load()}
      />
    );

  const state = snapshot.state;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 lg:mb-10">
          <h1 className="flex items-center gap-5 leading-none">
            <img
              src="/airdeck.svg"
              alt="Airdeck"
              className="h-10 w-auto sm:h-12 lg:h-14"
              width={266}
              height={48}
            />
            <span className="text-[2.15rem] font-extralight tracking-[0.12em] text-muted-foreground/40 sm:text-[2.6rem] lg:text-[3.1rem] leading-none">
              HOST
            </span>
          </h1>
          {!snapshot.connected && (
            <span className="text-sm font-medium tracking-[0.14em] text-amber-600 uppercase dark:text-amber-400">
              Reconnecting
            </span>
          )}
        </header>

        {snapshot.error && (
          <div
            className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {snapshot.error}
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="space-y-6">
            <QRCard state={state} />
            <Roster
              players={state.players}
              layouts={state.layouts}
              now={now}
              onKick={onKick}
              onMove={onMove}
              onLayout={onLayout}
            />
          </div>
          <HostPanel
            state={state}
            onJoinsChange={onJoinsChange}
            onNewSession={onNewSession}
            onSave={onSaveSettings}
            onApplyLayoutToAll={onApplyLayoutToAll}
          />
        </div>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardDescription className="text-[11px] font-bold tracking-[0.16em] uppercase">
            Airdeck host
          </CardDescription>
          <CardTitle className="text-xl">Loading dashboard...</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-[shimmer_1.2s_ease-in-out_infinite] rounded-full bg-primary/60" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <Card className="w-full max-w-md border-destructive/50">
        <CardHeader>
          <CardDescription className="text-[11px] font-bold tracking-[0.16em] uppercase text-destructive">
            Airdeck host
          </CardDescription>
          <CardTitle>Dashboard unavailable</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={onRetry}>
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('dashboard root is missing');
root.replaceChildren();
createRoot(root).render(<Dashboard />);
