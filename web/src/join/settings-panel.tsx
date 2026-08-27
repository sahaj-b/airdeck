import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
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
import type { FeedbackController } from '@/controller/feedback';
import { SKINS } from '@/skins';
import { getSkin, setSkin } from '@/skins/loader';
import type { settingsStore } from './settings-store';

type Store = typeof settingsStore;

interface SettingsPanelProps {
  store: Store;
  feedback: FeedbackController;
  capabilityNotes: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layouts: { id: string; name: string }[];
  selectedLayout: string;
  onSelectLayout: (id: string) => void;
  connectionText: string;
  pingText: string;
}

function formatVibration(ms: number): string {
  return ms > 0 ? `${ms} ms` : 'Off';
}

export function SettingsPanel({
  store,
  feedback,
  capabilityNotes,
  open,
  onOpenChange,
  layouts,
  selectedLayout,
  onSelectLayout,
  connectionText,
  pingText,
}: SettingsPanelProps) {
  const vibrationMs = useStore(store, (s) => s.vibrationMs);
  const rumble = useStore(store, (s) => s.rumble);
  const sound = useStore(store, (s) => s.sound);
  const ignoreCutout = useStore(store, (s) => s.ignoreCutout);
  const setVibrationMs = useStore(store, (s) => s.setVibrationMs);
  const setRumble = useStore(store, (s) => s.setRumble);
  const setSound = useStore(store, (s) => s.setSound);
  const setIgnoreCutout = useStore(store, (s) => s.setIgnoreCutout);
  const setStoreSkin = useStore(store, (s) => s.setSkin);

  // keep skin in sync with loader on mount
  const [skin, setSkinLocal] = useState(() => getSkin());

  useEffect(() => {
    // sync store skin to loader
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

  return (
    <Drawer open={open} onOpenChange={onOpenChange} modal={true}>
      <DrawerContent
        className="mx-auto w-full max-w-[24rem] max-h-[90dvh] flex flex-col"
        aria-describedby={undefined}
      >
        <DrawerHeader className="text-left shrink-0">
          <DrawerTitle>Settings</DrawerTitle>
          <DrawerDescription>
            Controller and connection options
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-5">
          {/* Layout */}
          <div className="space-y-2">
            <Label>Layout</Label>
            <Select
              value={selectedLayout}
              onValueChange={(v) => v && onSelectLayout(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select layout" />
              </SelectTrigger>
              <SelectContent>
                {layouts.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Skin */}
          <div className="space-y-2">
            <Label>Skin</Label>
            <Select
              value={skin}
              onValueChange={(v) => v && handleSkinChange(v)}
            >
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

          {/* Vibration */}
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

          {/* Toggles */}
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

          {/* Diagnostics */}
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Connection</span>
              <span className="font-semibold">{connectionText}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Ping</span>
              <span className="font-semibold tabular-nums">{pingText}</span>
            </div>
            {capabilityNotes && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                {capabilityNotes}
              </p>
            )}
          </div>

          <div className="pt-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
