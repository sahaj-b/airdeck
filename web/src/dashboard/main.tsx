import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { AdminStore, useAdminSnapshot } from './admin-store';
import type { SettingsUpdate } from './api';
import { QRCard } from './components/qr-card';
import { Roster } from './components/roster';
import { SessionControls } from './components/session-controls';
import { Settings } from './components/settings';
import './dashboard.css';

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
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Airdeck host</p>
          <h1>Local gamepad dashboard</h1>
          <p className="dashboard-intro">
            Run the session from this host. Phones join through the displayed
            LAN address.
          </p>
        </div>
        <Badge variant={snapshot.connected ? 'success' : 'warning'}>
          {snapshot.connected
            ? 'Live updates connected'
            : 'Reconnecting dashboard'}
        </Badge>
      </header>

      {snapshot.error && (
        <div className="dashboard-error" role="alert">
          {snapshot.error}
        </div>
      )}

      <div className="dashboard-top-grid">
        <QRCard state={state} />
        <SessionControls
          state={state}
          onJoinsChange={onJoinsChange}
          onNewSession={onNewSession}
        />
      </div>

      <Roster
        players={state.players}
        layouts={state.layouts}
        now={now}
        onKick={onKick}
        onMove={onMove}
        onLayout={onLayout}
      />

      <Settings state={state} onSave={onSaveSettings} />
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="dashboard-message">
      <p className="eyebrow">Airdeck host</p>
      <h1>Loading dashboard...</h1>
    </main>
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
    <main className="dashboard-message">
      <p className="eyebrow">Airdeck host</p>
      <h1>Dashboard unavailable</h1>
      <p>{message}</p>
      <Button type="button" onClick={onRetry}>
        Retry
      </Button>
    </main>
  );
}

const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('dashboard root is missing');
root.replaceChildren();
createRoot(root).render(<Dashboard />);
