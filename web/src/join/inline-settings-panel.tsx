import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { SKINS } from '@/skins';
import { getSkin, setSkin } from '@/skins/loader';
import type { MountOptions } from './settings-island';

export function InlineSettingsPanel({
  opts,
  onOpenGyro,
  onClose,
}: {
  opts: MountOptions;
  onOpenGyro: () => void;
  onClose: () => void;
}) {
  const store = opts.store;
  const feedback = opts.feedback;
  const vibrationMs = useStore(store, (s) => s.vibrationMs);
  const rumble = useStore(store, (s) => s.rumble);
  const sound = useStore(store, (s) => s.sound);
  const ignoreCutout = useStore(store, (s) => s.ignoreCutout);
  const setVibrationMs = useStore(store, (s) => s.setVibrationMs);
  const setRumble = useStore(store, (s) => s.setRumble);
  const setSound = useStore(store, (s) => s.setSound);
  const setIgnoreCutout = useStore(store, (s) => s.setIgnoreCutout);
  const setStoreSkin = useStore(store, (s) => s.setSkin);
  const gyroEnabled = useStore(store, (s) => s.gyroEnabled);
  const gyroTarget = useStore(store, (s) => s.gyroTarget);
  const gyroMode = useStore(store, (s) => s.gyroMode);
  const [skin, setSkinLocal] = useState(() => getSkin());

  useEffect(() => {
    const unsub = store.subscribe((state) => {
      if (state.skin !== skin) {
        setSkinLocal(state.skin);
        setSkin(state.skin);
      }
    });
    return unsub;
  }, [store, skin]);

  const handleSkinChange = (id: string) => {
    setSkinLocal(id);
    setStoreSkin(id);
    setSkin(id);
  };

  function formatVibration(ms: number): string {
    return ms > 0 ? `${ms} ms` : 'Off';
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-medium">Settings</h2>
      </div>
      <div className="space-y-2">
        <Label>Layout</Label>
        <Select
          value={opts.selectedLayout}
          onValueChange={(v) => v && opts.onSelectLayout(v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select layout" />
          </SelectTrigger>
          <SelectContent>
            {opts.layouts.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Skin</Label>
        <Select value={skin} onValueChange={(v) => v && handleSkinChange(v)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select skin" />
          </SelectTrigger>
          <SelectContent>
            {SKINS.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Separator />
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Button vibration</Label>
          <span className="text-sm font-semibold tabular-nums">
            {formatVibration(vibrationMs)}
          </span>
        </div>
        <Slider
          value={[vibrationMs]}
          min={0}
          max={100}
          step={10}
          onValueChange={(value) => {
            const next = (value as number[])[0] ?? 0;
            setVibrationMs(next);
            feedback.setPreferences({ pressVibrationMs: next });
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="rumble-toggle" className="flex-1">
          Game rumble
        </Label>
        <Switch
          id="rumble-toggle"
          checked={rumble}
          onCheckedChange={(v) => {
            setRumble(v);
            feedback.setPreferences({ rumble: v });
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="sound-toggle" className="flex-1">
          Button sounds
        </Label>
        <Switch
          id="sound-toggle"
          checked={sound}
          onCheckedChange={(v) => {
            setSound(v);
            feedback.setPreferences({ sound: v });
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="cutout-toggle" className="flex-1">
          Ignore display cutout
        </Label>
        <Switch
          id="cutout-toggle"
          checked={ignoreCutout}
          onCheckedChange={(v) => {
            setIgnoreCutout(v);
            const host = document.querySelector('.controller-host');
            host?.classList.toggle('ignore-cutout', v);
          }}
        />
      </div>
      <Separator />
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
        onClick={onOpenGyro}
      >
        <span className="font-medium">Gyroscope</span>
        <span className="flex items-center gap-2 text-muted-foreground">
          <span className="tabular-nums">
            {gyroEnabled ? `${gyroMode} · ${gyroTarget}` : 'Off'}
          </span>
          <span aria-hidden>›</span>
        </span>
      </button>
      <Separator />
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Connection</span>
          <span className="font-semibold">{opts.connectionText}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Ping</span>
          <span className="font-semibold tabular-nums">{opts.pingText}</span>
        </div>
        {opts.capabilityNotes && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {opts.capabilityNotes}
          </p>
        )}
      </div>
      <div className="pt-2">
        <Button variant="outline" className="w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
