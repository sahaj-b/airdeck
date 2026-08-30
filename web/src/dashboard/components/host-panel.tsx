import { Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { buttonVariants } from '../../components/ui/button-variants';
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
import { cn } from '../../lib/utils';
import type { AdminState } from '../../shared/contracts';
import type { SettingsUpdate } from '../api';

interface HostPanelProps {
  state: AdminState;
  onJoinsChange: (value: boolean) => void;
  onNewSession: () => void;
  onSave: (update: SettingsUpdate) => void;
  onApplyLayoutToAll: (layoutId: string) => void;
  onReloadLayouts: () => void;
}

export function HostPanel({
  state,
  onJoinsChange,
  onNewSession,
  onSave,
  onApplyLayoutToAll,
  onReloadLayouts,
}: HostPanelProps) {
  const [bind, setBind] = useState(state.config.bind);
  const [port, setPort] = useState(String(state.config.port));
  const advertisedHostRef = useRef(state.config.advertisedHost);
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

  const lastServerRef = useRef(state.config);
  const lastCandidatesRef = useRef(state.advertisedCandidates.join('|'));

  useEffect(() => {
    const prev = lastServerRef.current;
    const curr = state.config;
    const candidatesKey = state.advertisedCandidates.join('|');
    const candidatesChanged = candidatesKey !== lastCandidatesRef.current;

    if (curr.advertisedHost !== prev.advertisedHost) {
      lastCandidatesRef.current = candidatesKey;
      advertisedHostRef.current = curr.advertisedHost;
      setAdvertisedHostSelect(
        deriveHostSelect(curr.advertisedHost, state.advertisedCandidates),
      );
      setCustomHost(
        isCustomHost(curr.advertisedHost, state.advertisedCandidates)
          ? curr.advertisedHost
          : '',
      );
    } else if (candidatesChanged) {
      lastCandidatesRef.current = candidatesKey;
      setAdvertisedHostSelect((prevSelect) =>
        prevSelect === '__custom__'
          ? prevSelect
          : deriveHostSelect(curr.advertisedHost, state.advertisedCandidates),
      );
    }

    if (curr.bind !== prev.bind) setBind(curr.bind);
    if (curr.port !== prev.port) setPort(String(curr.port));
    if (curr.advertisedPort !== prev.advertisedPort)
      setAdvertisedPort(String(curr.advertisedPort));
    if (curr.defaultLayout !== prev.defaultLayout)
      setDefaultLayout(curr.defaultLayout);
    if (curr.gracePeriodSeconds !== prev.gracePeriodSeconds)
      setGracePeriodSeconds(curr.gracePeriodSeconds);

    lastServerRef.current = curr;
  }, [state.advertisedCandidates, state.config]);

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSave({
      bind: bind.trim(),
      port: numberValue(port),
      advertisedHost: advertisedHostRef.current.trim(),
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
          <GeneralSection
            acceptingJoins={state.acceptingJoins}
            defaultLayout={defaultLayout}
            layouts={state.layouts}
            playerCount={state.players.length}
            onJoinsChange={onJoinsChange}
            onLayoutChange={handleDefaultLayoutChange}
            onApplyLayoutToAll={onApplyLayoutToAll}
            onReloadLayouts={onReloadLayouts}
          />

          <Separator />

          <NetworkSection
            bind={bind}
            port={port}
            advertisedHostSelect={advertisedHostSelect}
            customHost={customHost}
            advertisedPort={advertisedPort}
            gracePeriodSeconds={gracePeriodSeconds}
            advertisedCandidates={state.advertisedCandidates}
            autoLabel={autoLabel}
            onBindChange={setBind}
            onPortChange={setPort}
            onHostSelectChange={(value) => {
              if (value === null) return;
              setAdvertisedHostSelect(value);
              if (value === '__custom__') {
                advertisedHostRef.current = customHost.trim();
              } else if (value === 'auto') {
                advertisedHostRef.current = '';
              } else {
                advertisedHostRef.current = value;
              }
            }}
            onCustomHostChange={(v) => {
              setCustomHost(v);
              advertisedHostRef.current = v.trim();
            }}
            onAdvertisedPortChange={setAdvertisedPort}
            onGraceChange={setGracePeriodSeconds}
            onSave={save}
          />
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

function GeneralSection({
  acceptingJoins,
  defaultLayout,
  layouts,
  playerCount,
  onJoinsChange,
  onLayoutChange,
  onApplyLayoutToAll,
  onReloadLayouts,
}: {
  acceptingJoins: boolean;
  defaultLayout: string;
  layouts: AdminState['layouts'];
  playerCount: number;
  onJoinsChange: (v: boolean) => void;
  onLayoutChange: (v: string | null) => void;
  onApplyLayoutToAll: (id: string) => void;
  onReloadLayouts: () => void;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <Label htmlFor="accepting-joins" className="shrink-0 text-sm">
            Accept new joins
          </Label>
          <Switch
            id="accepting-joins"
            checked={acceptingJoins}
            onCheckedChange={(checked) => onJoinsChange(checked)}
            className="ml-auto"
          />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {acceptingJoins
            ? 'Players can enter the session.'
            : 'New joins are blocked.'}
        </p>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <Label htmlFor="default-layout-top" className="shrink-0 text-sm">
            Layout
          </Label>
          <Select value={defaultLayout} onValueChange={onLayoutChange}>
            <SelectTrigger
              id="default-layout-top"
              className="ml-auto w-[200px]"
            >
              <SelectValue placeholder="Select layout" />
            </SelectTrigger>
            <SelectContent>
              {layouts.map((layout) => (
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
      {playerCount > 0 && (
        <Button
          type="button"
          variant="outline"
          onClick={() => onApplyLayoutToAll(defaultLayout)}
          className="w-full justify-center"
        >
          Apply to all {playerCount} players
        </Button>
      )}
      <a
        href="/editor"
        className={cn(
          buttonVariants({ variant: 'outline', size: 'default' }),
          'w-full justify-center gap-1.5',
        )}
      >
        <Pencil className="size-3.5" />
        Edit layouts
      </a>
      <Button
        type="button"
        variant="outline"
        onClick={onReloadLayouts}
        className="w-full justify-center"
      >
        Reload layouts
      </Button>
    </section>
  );
}

function NetworkSection({
  bind,
  port,
  advertisedHostSelect,
  customHost,
  advertisedPort,
  gracePeriodSeconds,
  advertisedCandidates,
  autoLabel,
  onBindChange,
  onPortChange,
  onHostSelectChange,
  onCustomHostChange,
  onAdvertisedPortChange,
  onGraceChange,
  onSave,
}: {
  bind: string;
  port: string;
  advertisedHostSelect: string;
  customHost: string;
  advertisedPort: string;
  gracePeriodSeconds: number;
  advertisedCandidates: string[];
  autoLabel: string;
  onBindChange: (v: string) => void;
  onPortChange: (v: string) => void;
  onHostSelectChange: (v: string | null) => void;
  onCustomHostChange: (v: string) => void;
  onAdvertisedPortChange: (v: string) => void;
  onGraceChange: (v: number) => void;
  onSave: (e: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Network
      </h2>
      <form onSubmit={onSave} className="space-y-3">
        <div className="flex items-center gap-3">
          <Label htmlFor="bind-address" className="shrink-0 text-sm">
            Bind address
          </Label>
          <Input
            id="bind-address"
            value={bind}
            onChange={(event) => onBindChange(event.target.value)}
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
            onChange={(event) => onPortChange(event.target.value)}
            className="ml-auto w-[200px]"
          />
        </div>

        <div className="flex items-center gap-3">
          <Label htmlFor="advertised-host" className="shrink-0 text-sm">
            Advertised host
          </Label>
          <Select
            value={advertisedHostSelect}
            onValueChange={onHostSelectChange}
          >
            <SelectTrigger id="advertised-host" className="ml-auto w-[200px]">
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
              {advertisedCandidates.map((ip) => (
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
              onChange={(event) => onCustomHostChange(event.target.value)}
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
              onChange={(event) => onAdvertisedPortChange(event.target.value)}
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
                    onGraceChange(Math.min(60, Math.max(1, v)));
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
  );
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function deriveHostSelect(host: string, candidates: string[]): string {
  if (!host) return 'auto';
  return candidates.includes(host) ? host : '__custom__';
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
