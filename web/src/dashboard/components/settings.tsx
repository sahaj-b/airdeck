import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
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
import { Slider } from '../../components/ui/slider';
import type { AdminState } from '../../shared/contracts';
import type { SettingsUpdate } from '../api';

interface SettingsProps {
  state: AdminState;
  onSave: (update: SettingsUpdate) => void;
}

export function Settings({ state, onSave }: SettingsProps) {
  const [bind, setBind] = useState(state.config.bind);
  const [port, setPort] = useState(String(state.config.port));
  const [advertisedHost, setAdvertisedHost] = useState(
    state.config.advertisedHost,
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

  useEffect(() => {
    setBind(state.config.bind);
    setPort(String(state.config.port));
    setAdvertisedHost(state.config.advertisedHost);
    setAdvertisedPort(String(state.config.advertisedPort));
    setDefaultLayout(state.config.defaultLayout);
    setGracePeriodSeconds(state.config.gracePeriodSeconds);
  }, [
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
      defaultLayout,
      gracePeriodSeconds,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription className="text-[11px] font-bold tracking-[0.16em] uppercase">
          Host settings
        </CardDescription>
        <CardTitle className="text-lg">Network and defaults</CardTitle>
        <CardDescription>
          Changes to bind address or port rebind the listener. Existing phone
          sockets stay connected.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="bind-address">Bind address</Label>
            <Input
              id="bind-address"
              value={bind}
              onChange={(event) => setBind(event.target.value)}
              autoComplete="off"
              placeholder="0.0.0.0"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="listen-port">Listen port</Label>
            <Input
              id="listen-port"
              type="number"
              min={0}
              max={65535}
              value={port}
              onChange={(event) => setPort(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="advertised-host">Advertised host</Label>
            <Input
              id="advertised-host"
              value={advertisedHost}
              onChange={(event) => setAdvertisedHost(event.target.value)}
              autoComplete="off"
              placeholder="LAN address or hostname"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="advertised-port">Advertised port</Label>
            <Input
              id="advertised-port"
              type="number"
              min={0}
              max={65535}
              value={advertisedPort}
              onChange={(event) => setAdvertisedPort(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Use 0 to advertise the selected public port.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="default-layout">Default layout</Label>
            <Select
              value={defaultLayout}
              onValueChange={(v) => v && setDefaultLayout(v)}
            >
              <SelectTrigger id="default-layout" className="w-full">
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

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="grace-period">Reconnect grace period</Label>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
                {gracePeriodSeconds}s
              </span>
            </div>
            <Slider
              id="grace-period"
              value={[gracePeriodSeconds]}
              min={1}
              max={60}
              step={1}
              onValueChange={(value) => {
                const next = (value as number[])[0];
                if (next != null) setGracePeriodSeconds(next);
              }}
            />
            <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
              <span>1s</span>
              <span>60s</span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              How long to reserve a disconnected player&apos;s slot.
            </p>
          </div>

          <div className="md:col-span-2">
            <Separator className="my-2" />
          </div>

          <div className="flex justify-end md:col-span-2">
            <Button type="submit">Save settings</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
