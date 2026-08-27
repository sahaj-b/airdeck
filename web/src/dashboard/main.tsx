import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { Badge } from '../components/ui/badge';
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
import { QRCard } from './components/qr-card';
import { Roster } from './components/roster';
import { SessionControls } from './components/session-controls';
import { Settings } from './components/settings';

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
        {/* header */}
        <header className="mb-6 flex flex-col gap-4 lg:mb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-2 text-[11px] font-bold tracking-[0.16em] text-primary uppercase">
              Airdeck host
            </div>
            <h1 className="font-heading text-[2rem] leading-none font-semibold tracking-[-0.04em] sm:text-[2.5rem] lg:text-[3rem]">
              Local gamepad dashboard
            </h1>
            <p className="mt-3 max-w-[620px] text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
              Run the session from this host. Phones join through the displayed
              LAN address.
            </p>
          </div>
          <Badge
            variant={snapshot.connected ? 'default' : 'secondary'}
            className={
              snapshot.connected
                ? 'bg-emerald-600 text-white hover:bg-emerald-600/90 dark:bg-emerald-500 dark:text-white'
                : 'bg-amber-500 text-white hover:bg-amber-500/90 dark:bg-amber-500'
            }
          >
            <span
              className={`size-1.5 rounded-full ${snapshot.connected ? 'bg-white animate-pulse' : 'bg-white/80'}`}
            />
            {snapshot.connected
              ? 'Live updates connected'
              : 'Reconnecting dashboard'}
          </Badge>
        </header>

        {snapshot.error && (
          <div
            className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {snapshot.error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <QRCard state={state} />
          <SessionControls
            state={state}
            onJoinsChange={onJoinsChange}
            onNewSession={onNewSession}
          />
        </div>

        <div className="mt-6">
          <Roster
            players={state.players}
            layouts={state.layouts}
            now={now}
            onKick={onKick}
            onMove={onMove}
            onLayout={onLayout}
          />
        </div>

        <div className="mt-6">
          <Settings state={state} onSave={onSaveSettings} />
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Airdeck · local host dashboard ·{' '}
          <span className="tabular-nums">{state.publicPort}</span> public /{' '}
          <span className="tabular-nums">{state.adminPort}</span> admin
        </p>
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
