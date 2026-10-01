import {
  ChevronRight,
  Gamepad2,
  Paintbrush,
  Vibrate,
  VibrateOff,
  Volume2,
  VolumeOff,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSlider } from '@/components/ui/native-slider';
import { Switch } from '@/components/ui/switch';
import { SKINS } from '@/skins';
import { GyroIcon, RumbleIcon, RumbleOffIcon } from './phone-icons';
import { SectionHeader } from './section-header';
import type { MountOptions } from './settings-island';
import { StickFeelSettings } from './stick-feel-settings';

function formatVibration(ms: number): string {
  return ms > 0 ? `${ms} ms` : 'Off';
}

// Last-resort display for a selected id that matches no known layout
// (stale storage, deleted host layout). Layout ids are name slugs, so this
// usually reconstructs the real name instead of leaking kebab-case.
function humanizeLayoutId(id: string): string {
  const words = id
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length > 0 ? words.join(' ') : 'Select layout';
}

const drillRow =
  'flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/40 active:bg-accent/60';
const drillIcon =
  'grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.06] ring-1 ring-white/10';
const drillText = 'flex min-w-0 flex-1 flex-col items-start leading-tight';
const drillSub = 'truncate text-[11px] text-muted-foreground';
const drillPill =
  'inline-flex min-w-0 max-w-[160px] items-center truncate rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground ring-1 ring-border';
const drillValueWrap = 'flex shrink-0 items-center gap-1.5';

function FeedbackButton({
  pressed,
  disabled,
  onClick,
  label,
  title,
  sub,
  children,
}: {
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  const lit = pressed && !disabled;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      className={`relative flex flex-col items-center justify-center gap-1 rounded-xl border bg-card p-3 pt-4 pb-3 text-center transition-colors active:scale-[0.97] ${lit ? 'border-white/15 bg-primary/10 shadow-[0_1px_2px_rgb(0_0_0/0.45),inset_0_1px_0_rgb(255_255_255/0.12)] hover:border-white/20' : 'border-white/30 bg-card shadow-sm hover:bg-accent/30 hover:border-white/40'} ${disabled ? 'cursor-not-allowed opacity-80' : ''}`}
    >
      {children}
      <span
        className={`text-xs font-semibold leading-none ${!lit ? 'opacity-70' : ''}`}
      >
        {title}
      </span>
      <span
        className={`text-[10px] font-medium leading-none tracking-wide text-muted-foreground ${!lit ? 'opacity-70' : ''}`}
      >
        {sub}
      </span>
    </button>
  );
}

export function InlineSettingsPanel({
  opts,
  onOpenGyro,
  onOpenLayouts,
  onOpenSkins,
  onClose,
}: {
  opts: MountOptions;
  onOpenGyro: () => void;
  onOpenLayouts: () => void;
  onOpenSkins: () => void;
  onClose: () => void;
}) {
  const store = opts.store;
  const feedback = opts.feedback;
  const vibrationMs = useStore(store, (s) => s.vibrationMs);
  const joystickPressMs = useStore(store, (s) => s.joystickPressMs);
  const joystickEdgeMs = useStore(store, (s) => s.joystickEdgeMs);
  const rumble = useStore(store, (s) => s.rumble);
  const sound = useStore(store, (s) => s.sound);
  const ignoreCutout = useStore(store, (s) => s.ignoreCutout);
  const setVibrationMs = useStore(store, (s) => s.setVibrationMs);
  const setJoystickPressMs = useStore(store, (s) => s.setJoystickPressMs);
  const setJoystickEdgeMs = useStore(store, (s) => s.setJoystickEdgeMs);
  const setRumble = useStore(store, (s) => s.setRumble);
  const setSound = useStore(store, (s) => s.setSound);
  const setIgnoreCutout = useStore(store, (s) => s.setIgnoreCutout);
  const skin = useStore(store, (s) => s.skin);
  const gyroEnabled = useStore(store, (s) => s.gyroEnabled);
  const gyroTarget = useStore(store, (s) => s.gyroTarget);
  const gyroMode = useStore(store, (s) => s.gyroMode);

  const hapticsAvailable = feedback.hapticsAvailable;
  const feedbackOn =
    hapticsAvailable &&
    (vibrationMs > 0 || joystickPressMs > 0 || joystickEdgeMs > 0);
  const prevVibrationRef = useRef({
    vibrationMs,
    joystickPressMs,
    joystickEdgeMs,
  });

  useEffect(() => {
    if (feedbackOn) {
      prevVibrationRef.current = {
        vibrationMs,
        joystickPressMs,
        joystickEdgeMs,
      };
    }
  }, [feedbackOn, vibrationMs, joystickPressMs, joystickEdgeMs]);

  const previewVibration = (ms: number) => {
    if (!hapticsAvailable || ms <= 0) return;
    try {
      feedback.previewVibration(ms);
    } catch {}
  };

  const handleFeedbackToggle = () => {
    if (!hapticsAvailable) return;
    const isOn = feedbackOn;
    if (isOn) {
      prevVibrationRef.current = {
        vibrationMs,
        joystickPressMs,
        joystickEdgeMs,
      };
      setVibrationMs(0);
      setJoystickPressMs(0);
      setJoystickEdgeMs(0);
      feedback.setPreferences({
        pressVibrationMs: 0,
        joystickPressMs: 0,
        joystickEdgeMs: 0,
      });
    } else {
      const prev = prevVibrationRef.current;
      const nextV = prev.vibrationMs || 40;
      const nextP = prev.joystickPressMs || 35;
      const nextE = prev.joystickEdgeMs || 35;
      setVibrationMs(nextV);
      setJoystickPressMs(nextP);
      setJoystickEdgeMs(nextE);
      feedback.setPreferences({
        pressVibrationMs: nextV,
        joystickPressMs: nextP,
        joystickEdgeMs: nextE,
      });
      previewVibration(nextV);
    }
  };

  const personalLayouts = opts.personalLayouts ?? [];
  const hostLayouts = opts.layouts;
  const selectedLayoutName =
    [...personalLayouts, ...hostLayouts].find(
      (l) => l.id === opts.selectedLayout,
    )?.name ?? humanizeLayoutId(opts.selectedLayout);
  const selectedSkinName = SKINS.find((s) => s.id === skin)?.name ?? skin;

  return (
    <div className="space-y-5 min-w-0 max-w-full overflow-x-hidden">
      <div>
        <SectionHeader>Controller</SectionHeader>
        <div className="mt-1.5 divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-white/[0.05] shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]">
          <button type="button" className={drillRow} onClick={onOpenLayouts}>
            <span className={drillIcon}>
              <Gamepad2 className="size-4 text-foreground" />
            </span>
            <span className={drillText}>
              <span className="text-sm font-medium">Layout</span>
              <span className={drillSub}>Switch, edit, publish</span>
            </span>
            <span className={drillValueWrap}>
              <span className={drillPill}>{selectedLayoutName}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </span>
          </button>
          <button type="button" className={drillRow} onClick={onOpenSkins}>
            <span className={drillIcon}>
              <Paintbrush className="size-4 text-foreground" />
            </span>
            <span className={drillText}>
              <span className="text-sm font-medium">Skins</span>
              <span className={drillSub}>Change the look</span>
            </span>
            <span className={drillValueWrap}>
              <span className={drillPill}>{selectedSkinName}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </span>
          </button>
          <button type="button" className={drillRow} onClick={onOpenGyro}>
            <span className={drillIcon}>
              <GyroIcon className="size-4 text-foreground" />
            </span>
            <span className={drillText}>
              <span className="text-sm font-medium">Gyroscope</span>
              <span className={drillSub}>Tilt to steer or aim</span>
            </span>
            <span className={drillValueWrap}>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest ${gyroEnabled ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground ring-1 ring-border'}`}
              >
                {gyroEnabled
                  ? `${gyroMode.toUpperCase()} · ${gyroTarget === 'leftStick' ? 'LEFT STICK' : 'RIGHT STICK'}`
                  : 'OFF'}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </span>
          </button>
        </div>
      </div>
      <div>
        <SectionHeader>Vibration & Sound</SectionHeader>
        <div className="pt-3">
          <div className="grid grid-cols-3 gap-2">
            <FeedbackButton
              pressed={feedbackOn}
              disabled={!hapticsAvailable}
              onClick={handleFeedbackToggle}
              label="Toggle buttons buzz"
              title="Buttons buzz"
              sub="Haptics"
            >
              {feedbackOn ? (
                <Vibrate className="size-7 shrink-0" />
              ) : (
                <VibrateOff className="size-7 shrink-0 opacity-70" />
              )}
            </FeedbackButton>
            <FeedbackButton
              pressed={rumble}
              disabled={!hapticsAvailable}
              onClick={() => {
                const next = !rumble;
                setRumble(next);
                feedback.setPreferences({ rumble: next });
                if (next) previewVibration(40);
              }}
              label="Toggle game vibration"
              title="Game Vibration"
              sub="Rumble"
            >
              {rumble && hapticsAvailable ? (
                <RumbleIcon className="size-8 shrink-0" />
              ) : (
                <RumbleOffIcon className="size-8 shrink-0 opacity-70" />
              )}
            </FeedbackButton>
            <FeedbackButton
              pressed={sound}
              onClick={() => {
                const next = !sound;
                setSound(next);
                feedback.setPreferences({ sound: next });
              }}
              label="Toggle button sounds"
              title="Button sounds"
              sub="Audio Haptics"
            >
              {sound ? (
                <Volume2 className="size-7 shrink-0" />
              ) : (
                <VolumeOff className="size-7 shrink-0 opacity-70" />
              )}
            </FeedbackButton>
          </div>
          {!hapticsAvailable && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Unavailable on this device
            </p>
          )}
          {feedbackOn && (
            <div className="mt-4 space-y-3" data-base-ui-swipe-ignore>
              <div className="grid grid-cols-[1fr_auto_135px] sm:grid-cols-[1fr_auto_165px] items-center gap-2">
                <span className="text-sm font-medium">Button press</span>
                <span className="w-11 text-right text-sm font-semibold tabular-nums whitespace-nowrap">
                  {formatVibration(vibrationMs)}
                </span>
                <NativeSlider
                  label="Button press vibration"
                  value={vibrationMs}
                  min={0}
                  max={100}
                  step={5}
                  onChange={(next) => {
                    setVibrationMs(next);
                    feedback.setPreferences({ pressVibrationMs: next });
                  }}
                  onCommit={previewVibration}
                />
              </div>
              <div className="grid grid-cols-[1fr_auto_135px] sm:grid-cols-[1fr_auto_165px] items-center gap-2">
                <span className="text-sm font-medium">Joystick press</span>
                <span className="w-11 text-right text-sm font-semibold tabular-nums whitespace-nowrap">
                  {formatVibration(joystickPressMs)}
                </span>
                <NativeSlider
                  label="Joystick press vibration"
                  value={joystickPressMs}
                  min={0}
                  max={100}
                  step={5}
                  onChange={(next) => {
                    setJoystickPressMs(next);
                    feedback.setPreferences({ joystickPressMs: next });
                  }}
                  onCommit={previewVibration}
                />
              </div>
              <div className="grid grid-cols-[1fr_auto_135px] sm:grid-cols-[1fr_auto_165px] items-center gap-2">
                <span className="text-sm font-medium">Joystick at Edge</span>
                <span className="w-11 text-right text-sm font-semibold tabular-nums whitespace-nowrap">
                  {formatVibration(joystickEdgeMs)}
                </span>
                <NativeSlider
                  label="Joystick at edge vibration"
                  value={joystickEdgeMs}
                  min={0}
                  max={100}
                  step={5}
                  onChange={(next) => {
                    setJoystickEdgeMs(next);
                    feedback.setPreferences({ joystickEdgeMs: next });
                  }}
                  onCommit={previewVibration}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      <StickFeelSettings opts={opts} />
      <div>
        <SectionHeader>Others</SectionHeader>
        <div className="space-y-4 pt-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="cutout-toggle" className="flex-1">
              Ignore punchole
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

          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Connection</span>
              <span className="font-semibold">{opts.connectionText}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Ping</span>
              <span className="font-semibold tabular-nums">
                {opts.pingText}
              </span>
            </div>
            {opts.capabilityNotes && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                {opts.capabilityNotes}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="pt-2">
        <Button variant="outline" className="w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
