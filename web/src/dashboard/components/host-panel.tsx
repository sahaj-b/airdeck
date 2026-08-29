import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Separator } from '../../components/ui/separator';
import { Switch } from '../../components/ui/switch';
import type { AdminState } from '../../shared/contracts';
import type { SettingsUpdate } from '../api';

interface HostPanelProps {
  state: AdminState;
  onJoinsChange: (value: boolean) => void;
  onNewSession: () => void;
  onSave: (update: SettingsUpdate) => void;
  onApplyLayoutToAll: (layoutId: string) => void;
}

export function HostPanel({
  state,
  onJoinsChange,
  onNewSession,
  onSave,
  onApplyLayoutToAll,
}: HostPanelProps) {
  const [bind, setBind] = useState(state.config.bind);
  const [port, setPort] = useState(String(state.config.port));
  const [advertisedHost, setAdvertisedHost] = useState(
    state.config.advertisedHost,
  );
  const [advertisedHostSelect, setAdvertisedHostSelect] = useState(() =>
    deriveHostSelect(state.config.advertisedHost, state.advertisedCandidates),
  );
  const autoLabel = `Auto (${autoHostLabel(state)})`;
  const [customHost, setCustomHost] = useState(() =>
    isCustomHost(state.config.advertisedHost, state.advertisedCandidates)
      ? state.config.advertisedHost
      : '',
  );
  const [advertisedPort, setAdvertisedPort] = useState(
    String(state.config.advertisedPort),
  );
  const [defaultLayout, setDefaultLayout] = useState(
    state.config.defaultLayout,
  );
  const [gracePeriodSeconds, setGracePeriodSeconds] = useState(
    state.config.gracePeriodSeconds,
  );

  // WS pushes state at 1Hz with new object identities. Naively syncing
  // every tick clobbers in-progress edits (e.g. Custom host input flashes
  // then snaps back to Auto). Only sync when the server value actually
  // changed from last synced, and preserve dirty local edits.
  const lastServerHostRef = useRef(state.config.advertisedHost);
  const lastServerCandidatesRef = useRef(state.advertisedCandidates.join('|'));
  const lastServerBindRef = useRef(state.config.bind);
  const lastServerPortRef = useRef(state.config.port);
  const lastServerAdvertisedPortRef = useRef(state.config.advertisedPort);
  const lastServerDefaultLayoutRef = useRef(state.config.defaultLayout);
  const lastServerGraceRef = useRef(state.config.gracePeriodSeconds);

  useEffect(() => {
    const serverHost = state.config.advertisedHost;
    const candidatesKey = state.advertisedCandidates.join('|');
    const hostChanged = serverHost !== lastServerHostRef.current;
    const candidatesChanged = candidatesKey !== lastServerCandidatesRef.current;

    if (hostChanged) {
      lastServerHostRef.current = serverHost;
      lastServerCandidatesRef.current = candidatesKey;
      setAdvertisedHost(serverHost);
      setAdvertisedHostSelect(
        deriveHostSelect(serverHost, state.advertisedCandidates),
      );
      setCustomHost(
        isCustomHost(serverHost, state.advertisedCandidates) ? serverHost : '',
      );
    } else if (candidatesChanged) {
      lastServerCandidatesRef.current = candidatesKey;
      // Candidates (LAN IPs) changed but host didn't — keep __custom__
      // editing intact, just refresh the select mapping for auto/ip.
      setAdvertisedHostSelect((prev) =>
        prev === '__custom__'
          ? prev
          : deriveHostSelect(serverHost, state.advertisedCandidates),
      );
    }

    if (state.config.bind !== lastServerBindRef.current) {
      lastServerBindRef.current = state.config.bind;
      setBind(state.config.bind);
    }
    if (state.config.port !== lastServerPortRef.current) {
      lastServerPortRef.current = state.config.port;
      setPort(String(state.config.port));
    }
    if (state.config.advertisedPort !== lastServerAdvertisedPortRef.current) {
      lastServerAdvertisedPortRef.current = state.config.advertisedPort;
      setAdvertisedPort(String(state.config.advertisedPort));
    }
    if (state.config.defaultLayout !== lastServerDefaultLayoutRef.current) {
      lastServerDefaultLayoutRef.current = state.config.defaultLayout;
      setDefaultLayout(state.config.defaultLayout);
    }
    if (state.config.gracePeriodSeconds !== lastServerGraceRef.current) {
      lastServerGraceRef.current = state.config.gracePeriodSeconds;
      setGracePeriodSeconds(state.config.gracePeriodSeconds);
    }
  }, [
    state.advertisedCandidates,
    state.config.advertisedHost,
    state.config.advertisedPort,
    state.config.bind,
    state.config.defaultLayout,
    state.config.gracePeriodSeconds,
    state.config.port,
  ]);

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSave({
      bind: bind.trim(),
      port: numberValue(port),
      advertisedHost: advertisedHost.trim(),
      advertisedPort: numberValue(advertisedPort),
      gracePeriodSeconds,
    });
  }

  function handleDefaultLayoutChange(value: string | null): void {
    if (!value) return;
    setDefaultLayout(value);
    onSave({ defaultLayout: value });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="space-y-3">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <Label htmlFor="accepting-joins" className="shrink-0 text-sm">
                  Accept new joins
                </Label>
                <Switch
                  id="accepting-joins"
                  checked={state.acceptingJoins}
                  onCheckedChange={(checked) => onJoinsChange(checked)}
                  className="ml-auto"
                />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {state.acceptingJoins
                  ? 'Players can enter the session.'
                  : 'New joins are blocked.'}
              </p>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <Label
                  htmlFor="default-layout-top"
                  className="shrink-0 text-sm"
                >
                  Layout
                </Label>
                <Select
                  value={defaultLayout}
                  onValueChange={handleDefaultLayoutChange}
                >
                  <SelectTrigger
                    id="default-layout-top"
                    className="ml-auto w-[200px]"
                  >
                    <SelectValue placeholder="Select layout" />
                  </SelectTrigger>
                  <SelectContent>
                    {state.layouts.map((layout) => (
                      <SelectItem key={layout.id} value={layout.id}>
                        {layout.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                New phones join with this. Existing players keep theirs.
              </p>
            </div>
            {state.players.length > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => onApplyLayoutToAll(defaultLayout)}
                className="w-full justify-center"
              >
                Apply to all {state.players.length} players
              </Button>
            )}
          </section>

          <Separator />

          <section className="space-y-3">
            <h2 className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
              Network
            </h2>
            <form onSubmit={save} className="space-y-3">
              <div className="flex items-center gap-3">
                <Label htmlFor="bind-address" className="shrink-0 text-sm">
                  Bind address
                </Label>
                <Input
                  id="bind-address"
                  value={bind}
                  onChange={(event) => setBind(event.target.value)}
                  autoComplete="off"
                  placeholder="0.0.0.0"
                  className="ml-auto w-[200px]"
                />
              </div>

              <div className="flex items-center gap-3">
                <Label htmlFor="listen-port" className="shrink-0 text-sm">
                  Listen port
                </Label>
                <Input
                  id="listen-port"
                  type="number"
                  min={0}
                  max={65535}
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                  className="ml-auto w-[200px]"
                />
              </div>

              <div className="flex items-center gap-3">
                <Label htmlFor="advertised-host" className="shrink-0 text-sm">
                  Advertised host
                </Label>
                <Select
                  value={advertisedHostSelect}
                  onValueChange={(value) => {
                    if (value === null) return;
                    setAdvertisedHostSelect(value);
                    if (value === '__custom__') {
                      setAdvertisedHost(customHost.trim());
                    } else if (value === 'auto') {
                      setAdvertisedHost('');
                    } else {
                      setAdvertisedHost(value);
                    }
                  }}
                >
                  <SelectTrigger
                    id="advertised-host"
                    className="ml-auto w-[200px]"
                  >
                    <span className="truncate text-sm">
                      {advertisedHostSelect === 'auto'
                        ? autoLabel
                        : advertisedHostSelect === '__custom__'
                          ? 'Custom…'
                          : advertisedHostSelect || autoLabel}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{autoLabel}</SelectItem>
                    {state.advertisedCandidates.map((ip) => (
                      <SelectItem key={ip} value={ip}>
                        {ip}
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom__">Custom…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {advertisedHostSelect === '__custom__' && (
                <div className="flex items-center gap-3">
                  <Label
                    htmlFor="advertised-host-custom"
                    className="shrink-0 text-sm"
                  >
                    Custom host
                  </Label>
                  <Input
                    id="advertised-host-custom"
                    value={customHost}
                    onChange={(event) => {
                      const v = event.target.value;
                      setCustomHost(v);
                      setAdvertisedHost(v.trim());
                    }}
                    autoComplete="off"
                    placeholder="hostname or IP"
                    className="ml-auto w-[200px]"
                  />
                </div>
              )}

              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <Label htmlFor="advertised-port" className="shrink-0 text-sm">
                    Advertised port
                  </Label>
                  <Input
                    id="advertised-port"
                    type="number"
                    min={0}
                    max={65535}
                    value={advertisedPort}
                    onChange={(event) => setAdvertisedPort(event.target.value)}
                    className="ml-auto w-[200px]"
                  />
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  0 = use listening port.
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <Label htmlFor="grace-period" className="shrink-0 text-sm">
                    Grace period
                  </Label>
                  <div className="ml-auto flex w-[200px] items-center gap-1.5">
                    <Input
                      id="grace-period"
                      type="number"
                      min={1}
                      max={60}
                      value={String(gracePeriodSeconds)}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v))
                          setGracePeriodSeconds(Math.min(60, Math.max(1, v)));
                      }}
                      className="flex-1 tabular-nums"
                    />
                    <span className="text-xs text-muted-foreground">s</span>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  How long to keep a disconnected slot reserved.
                </p>
              </div>

              <div className="pt-2">
                <Button type="submit" className="w-full">
                  Save settings
                </Button>
              </div>
            </form>
          </section>
        </CardContent>
      </Card>

      <div className="space-y-1">
        <Button
          type="button"
          variant="destructive"
          className="w-full"
          onClick={onNewSession}
        >
          Start new session
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Kicks all players and rotates the session code.
        </p>
      </div>
    </div>
  );
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function deriveHostSelect(host: string, candidates: string[]): string {
  if (!host) return 'auto';
  if (candidates.includes(host)) return host;
  return '__custom__';
}

function isCustomHost(host: string, candidates: string[]): boolean {
  return Boolean(host && !candidates.includes(host));
}

function autoHostLabel(state: AdminState): string {
  if (state.advertisedCandidates.length > 0)
    return state.advertisedCandidates[0];
  const url = (() => {
    try {
      return new URL(state.advertisedJoinURL).hostname;
    } catch {
      return 'auto';
    }
  })();
  return url || 'auto';
}
