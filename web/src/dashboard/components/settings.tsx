import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
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

  useEffect(() => {
    setBind(state.config.bind);
    setPort(String(state.config.port));
    setAdvertisedHost(state.config.advertisedHost);
    setAdvertisedPort(String(state.config.advertisedPort));
    setDefaultLayout(state.config.defaultLayout);
  }, [
    state.config.advertisedHost,
    state.config.advertisedPort,
    state.config.bind,
    state.config.defaultLayout,
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
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="eyebrow">Host settings</div>
        <h2>Network and defaults</h2>
        <p>
          Changes to bind address or port rebind the listener. Existing phone
          sockets stay connected.
        </p>
      </CardHeader>
      <CardContent>
        <form className="settings-form" onSubmit={save}>
          <label htmlFor="bind-address">
            Bind address
            <Input
              id="bind-address"
              value={bind}
              onChange={(event) => setBind(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label htmlFor="listen-port">
            Listen port
            <Input
              id="listen-port"
              type="number"
              min="0"
              max="65535"
              value={port}
              onChange={(event) => setPort(event.target.value)}
            />
          </label>
          <label htmlFor="advertised-host">
            Advertised host
            <Input
              id="advertised-host"
              value={advertisedHost}
              onChange={(event) => setAdvertisedHost(event.target.value)}
              autoComplete="off"
              placeholder="LAN address or hostname"
            />
          </label>
          <label htmlFor="advertised-port">
            Advertised port
            <Input
              id="advertised-port"
              type="number"
              min="0"
              max="65535"
              value={advertisedPort}
              onChange={(event) => setAdvertisedPort(event.target.value)}
            />
            <small>Use 0 to advertise the selected public port.</small>
          </label>
          <label htmlFor="default-layout">
            Default layout
            <Select
              id="default-layout"
              value={defaultLayout}
              onChange={(event) => setDefaultLayout(event.target.value)}
            >
              {state.layouts.map((layout) => (
                <option key={layout.id} value={layout.id}>
                  {layout.name}
                </option>
              ))}
            </Select>
          </label>
          <div className="settings-submit">
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
