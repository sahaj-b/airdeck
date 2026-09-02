import {
  ChevronRight,
  Gamepad2,
  Layers,
  Paintbrush,
  Pencil,
  Vibrate,
  VibrateOff,
  Volume2,
  VolumeOff,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { SKINS } from '@/skins';
import { getSkin, setSkin } from '@/skins/loader';
import type { MountOptions } from './settings-island';

function GyroIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      aria-hidden="true"
      {...props}
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="currentColor"
        d="m12.823 18.258l-7.113-7.12q-.23-.231-.354-.527q-.125-.295-.125-.612t.125-.611t.354-.526l3.152-3.153q.231-.236.527-.354q.295-.119.612-.119t.611.119t.527.354l7.113 7.114q.229.232.354.528q.125.295.125.611q0 .317-.125.612t-.354.526L15.1 18.258q-.232.236-.527.354q-.296.119-.612.119t-.611-.119t-.527-.354m.696-.72q.173.173.442.173t.443-.173l3.134-3.134q.173-.173.173-.443t-.173-.442l-7.096-7.096Q10.27 6.25 10 6.25t-.442.173L6.423 9.558Q6.25 9.73 6.25 10t.173.442zM12 23q-2.269 0-4.274-.86q-2.005-.859-3.506-2.36t-2.36-3.506T1 12h1q0 2.006.744 3.785q.744 1.778 2.028 3.117T7.8 21.057t3.744.903l-3.452-3.452l.708-.708l5.016 5.016q-.458.073-.906.128Q12.465 23 12 23m10-11q0-2.006-.744-3.784q-.745-1.78-2.028-3.118Q17.944 3.76 16.2 2.943t-3.744-.902l3.452 3.451l-.708.708l-5.015-5.015q.437-.093.899-.139T12 1q2.283 0 4.278.86q1.995.861 3.498 2.364t2.364 3.498T23 12zM9.417 10.139q.29 0 .484-.201q.193-.201.193-.469q0-.29-.193-.484t-.488-.193q-.273 0-.469.193t-.196.489q0 .272.201.468q.2.196.469.196"
      />
    </svg>
  );
}

function RumbleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="-1 -1 18 18"
      aria-hidden="true"
      {...props}
    >
      <path d="M0 0h16v16H0z" fill="none" />
      <g transform="rotate(-6 8 8)">
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth=".65"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M0.3 4.8L-0.8 5.9l1.1 1.1L-0.8 8.1l1.1 1.1" />
          <path d="M0.3 7.2L-0.8 8.3l1.1 1.1L-0.8 10.5l1.1 1.1" />
        </g>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth=".65"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15.7 4.8L16.8 5.9l-1.1 1.1L16.8 8.1l-1.1 1.1" />
          <path d="M15.7 7.2L16.8 8.3l-1.1 1.1L16.8 10.5l-1.1 1.1" />
        </g>
        <g transform="translate(0.8 0.8) scale(.92)" fill="currentColor">
          <path d="M11.5 6.027a.5.5 0 1 1-1 0a.5.5 0 0 1 1 0m-1.5 1.5a.5.5 0 1 0 0-1a.5.5 0 0 0 0 1m2.5-.5a.5.5 0 1 1-1 0a.5.5 0 0 1 1 0m-1.5 1.5a.5.5 0 1 0 0-1a.5.5 0 0 0 0 1m-6.5-3h1v1h1v1h-1v1h-1v-1h-1v-1h1z" />
          <path d="M3.051 3.26a.5.5 0 0 1 .354-.613l1.932-.518a.5.5 0 0 1 .62.39c.655-.079 1.35-.117 2.043-.117c.72 0 1.443.041 2.12.126a.5.5 0 0 1 .622-.399l1.932.518a.5.5 0 0 1 .306.729q.211.136.373.297c.408.408.78 1.05 1.095 1.772c.32.733.599 1.591.805 2.466s.34 1.78.364 2.606c.024.816-.059 1.602-.328 2.21a1.42 1.42 0 0 1-1.445.83c-.636-.067-1.115-.394-1.513-.773c-.245-.232-.496-.526-.739-.808c-.126-.148-.25-.292-.368-.423c-.728-.804-1.597-1.527-3.224-1.527s-2.496.723-3.224 1.527c-.119.131-.242.275-.368.423c-.243.282-.494.575-.739.808c-.398.38-.877.706-1.513.773a1.42 1.42 0 0 1-1.445-.83c-.27-.608-.352-1.395-.329-2.21c.024-.826.16-1.73.365-2.606c.206-.875.486-1.733.805-2.466c.315-.722.687-1.364 1.094-1.772a2.3 2.3 0 0 1 .433-.335l-.028-.079zm2.036.412c-.877.185-1.469.443-1.733.708c-.276.276-.587.783-.885 1.465a14 14 0 0 0-.748 2.295a12.4 12.4 0 0 0-.339 2.406c-.022.755.062 1.368.243 1.776a.42.42 0 0 0 .426.24c.327-.034.61-.199.929-.502c.212-.202.4-.423.615-.674c.133-.156.276-.323.44-.504C4.861 9.969 5.978 9.027 8 9.027s3.139.942 3.965 1.855c.164.181.307.348.44.504c.214.251.403.472.615.674c.318.303.601.468.929.503a.42.42 0 0 0 .426-.241c.18-.408.265-1.02.243-1.776a12.4 12.4 0 0 0-.339-2.406a14 14 0 0 0-.748-2.295c-.298-.682-.61-1.19-.885-1.465c-.264-.265-.856-.523-1.733-.708c-.85-.179-1.877-.27-2.913-.27s-2.063.091-2.913.27" />
        </g>
      </g>
    </svg>
  );
}

function RumbleOffIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="-1 -1 18 18"
      aria-hidden="true"
      {...props}
    >
      <path d="M0 0h16v16H0z" fill="none" />
      <g transform="rotate(-6 8 8)">
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth=".65"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M0.3 4.8L-0.8 5.9l1.1 1.1L-0.8 8.1l1.1 1.1" />
          <path d="M0.3 7.2L-0.8 8.3l1.1 1.1L-0.8 10.5l1.1 1.1" />
        </g>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth=".65"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15.7 4.8L16.8 5.9l-1.1 1.1L16.8 8.1l-1.1 1.1" />
          <path d="M15.7 7.2L16.8 8.3l-1.1 1.1L16.8 10.5l-1.1 1.1" />
        </g>
        <g transform="translate(0.8 0.8) scale(.92)" fill="currentColor">
          <path d="M11.5 6.027a.5.5 0 1 1-1 0a.5.5 0 0 1 1 0m-1.5 1.5a.5.5 0 1 0 0-1a.5.5 0 0 0 0 1m2.5-.5a.5.5 0 1 1-1 0a.5.5 0 0 1 1 0m-1.5 1.5a.5.5 0 1 0 0-1a.5.5 0 0 0 0 1m-6.5-3h1v1h1v1h-1v1h-1v-1h-1v-1h1z" />
          <path d="M3.051 3.26a.5.5 0 0 1 .354-.613l1.932-.518a.5.5 0 0 1 .62.39c.655-.079 1.35-.117 2.043-.117c.72 0 1.443.041 2.12.126a.5.5 0 0 1 .622-.399l1.932.518a.5.5 0 0 1 .306.729q.211.136.373.297c.408.408.78 1.05 1.095 1.772c.32.733.599 1.591.805 2.466s.34 1.78.364 2.606c.024.816-.059 1.602-.328 2.21a1.42 1.42 0 0 1-1.445.83c-.636-.067-1.115-.394-1.513-.773c-.245-.232-.496-.526-.739-.808c-.126-.148-.25-.292-.368-.423c-.728-.804-1.597-1.527-3.224-1.527s-2.496.723-3.224 1.527c-.119.131-.242.275-.368.423c-.243.282-.494.575-.739.808c-.398.38-.877.706-1.513.773a1.42 1.42 0 0 1-1.445-.83c-.27-.608-.352-1.395-.329-2.21c.024-.826.16-1.73.365-2.606c.206-.875.486-1.733.805-2.466c.315-.722.687-1.364 1.094-1.772a2.3 2.3 0 0 1 .433-.335l-.028-.079zm2.036.412c-.877.185-1.469.443-1.733.708c-.276.276-.587.783-.885 1.465a14 14 0 0 0-.748 2.295a12.4 12.4 0 0 0-.339 2.406c-.022.755.062 1.368.243 1.776a.42.42 0 0 0 .426.24c.327-.034.61-.199.929-.502c.212-.202.4-.423.615-.674c.133-.156.276-.323.44-.504C4.861 9.969 5.978 9.027 8 9.027s3.139.942 3.965 1.855c.164.181.307.348.44.504c.214.251.403.472.615.674c.318.303.601.468.929.503a.42.42 0 0 0 .426-.241c.18-.408.265-1.02.243-1.776a12.4 12.4 0 0 0-.339-2.406a14 14 0 0 0-.748-2.295c-.298-.682-.61-1.19-.885-1.465c-.264-.265-.856-.523-1.733-.708c-.85-.179-1.877-.27-2.913-.27s-2.063.091-2.913.27" />
        </g>
      </g>
      <path
        d="M 3 3 L 13 13"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.95"
      />
    </svg>
  );
}

function formatVibration(ms: number): string {
  return ms > 0 ? `${ms} ms` : 'Off';
}

export function InlineSettingsPanel({
  opts,
  onOpenGyro,
  onOpenManage,
  onClose,
}: {
  opts: MountOptions;
  onOpenGyro: () => void;
  onOpenManage: () => void;
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
      navigator.vibrate?.(ms);
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
    )?.name ?? opts.selectedLayout;
  const selectedSkinName = SKINS.find((s) => s.id === skin)?.name ?? skin;

  return (
    <div className="space-y-5 min-w-0 max-w-full overflow-x-hidden">
      <div className="relative mt-3 rounded-xl border bg-card">
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap bg-card px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Controller
        </div>
        <div className="divide-y">
          <div className="space-y-2.5 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Gamepad2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">Layout</span>
              </div>
              <Select
                value={opts.selectedLayout}
                onValueChange={(v) => v && opts.onSelectLayout(v)}
              >
                <SelectTrigger className="h-8 w-[calc(50%-4px)] shrink-0 gap-1.5 border-white/20 bg-white/[0.08] dark:bg-white/[0.08] pl-2.5 pr-2 backdrop-blur-sm shadow-sm">
                  <span className="flex-1 truncate text-left text-sm">
                    {selectedLayoutName || 'Select layout'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {personalLayouts.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>My edits</SelectLabel>
                      {personalLayouts.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  <SelectGroup>
                    <SelectLabel>Host layouts</SelectLabel>
                    {hostLayouts.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-auto min-h-7 w-full whitespace-normal bg-black/20 py-1.5 text-xs leading-tight backdrop-blur-sm hover:bg-black/30 dark:bg-zinc-900 dark:border-white/15"
                onClick={() => opts.onEditPersonal?.('__new_from_current')}
              >
                <Pencil className="size-3.5 shrink-0" />
                <span className="text-center">Edit current layout</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-auto min-h-7 w-full whitespace-normal border-white/30 bg-black/20 py-1.5 text-xs leading-tight backdrop-blur-sm hover:bg-black/30 dark:bg-zinc-900 dark:border-white/15"
                onClick={onOpenManage}
              >
                <Layers className="size-3.5 shrink-0" />
                <span className="text-center">Manage my layouts</span>
              </Button>
            </div>
            {opts.publishState && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                <p className="font-medium">
                  Publishing &apos;{opts.publishState.name}&apos; — waiting for
                  host approval... {opts.publishState.remaining}s
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => opts.onCancelPublish?.()}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 px-3 py-3">
            <div className="flex items-center gap-2">
              <Paintbrush className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">Skin</span>
            </div>
            <Select
              value={skin}
              onValueChange={(v) => v && handleSkinChange(v)}
            >
              <SelectTrigger className="h-8 w-[calc(50%-4px)] shrink-0 gap-1.5 border-white/20 bg-white/[0.08] dark:bg-white/[0.08] pl-2.5 pr-2 backdrop-blur-sm shadow-sm">
                <span className="flex-1 truncate text-left text-sm">
                  {selectedSkinName || 'Select skin'}
                </span>
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
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/50"
            onClick={onOpenGyro}
          >
            <span className="flex items-center gap-2">
              <GyroIcon className="size-[18px] shrink-0 text-foreground" />
              <span className="text-sm font-medium">Gyroscope</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest ${gyroEnabled ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground ring-1 ring-border'}`}
              >
                {gyroEnabled
                  ? `${gyroMode.toUpperCase()} · ${gyroTarget === 'leftStick' ? 'LEFT STICK' : 'RIGHT STICK'}`
                  : 'OFF'}
              </span>
              <ChevronRight className="size-3.5 shrink-0 opacity-60" />
            </span>
          </button>
        </div>
      </div>
      <div className="relative mt-6 rounded-xl border bg-card">
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap bg-card px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Vibration & Sound
        </div>
        <div className="p-3 pt-4">
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={!hapticsAvailable}
              onClick={handleFeedbackToggle}
              aria-pressed={feedbackOn}
              aria-label="Toggle buttons buzz"
              className={`relative flex flex-col items-center justify-center gap-1 rounded-xl border bg-card p-3 pt-4 pb-3 text-center shadow-sm transition-colors active:scale-[0.97] ${feedbackOn ? 'border-white/15 bg-primary/10 hover:border-white/20' : 'border-white/30 bg-card hover:bg-accent/30 hover:border-white/40'} ${!hapticsAvailable ? 'cursor-not-allowed opacity-80' : ''}`}
            >
              {feedbackOn ? (
                <Vibrate className="size-7 shrink-0" />
              ) : (
                <VibrateOff className="size-7 shrink-0 opacity-70" />
              )}
              <span
                className={`text-xs font-semibold leading-none ${!feedbackOn ? 'opacity-70' : ''}`}
              >
                Buttons buzz
              </span>
              <span
                className={`text-[10px] font-medium leading-none tracking-wide text-muted-foreground ${!feedbackOn ? 'opacity-70' : ''}`}
              >
                Haptics
              </span>
            </button>
            <button
              type="button"
              disabled={!hapticsAvailable}
              onClick={() => {
                const next = !rumble;
                setRumble(next);
                feedback.setPreferences({ rumble: next });
                if (next) previewVibration(40);
              }}
              aria-pressed={rumble}
              aria-label="Toggle game vibration"
              className={`relative flex flex-col items-center justify-center gap-1 rounded-xl border bg-card p-3 pt-4 pb-3 text-center shadow-sm transition-colors active:scale-[0.97] ${rumble && hapticsAvailable ? 'border-white/15 bg-primary/10 hover:border-white/20' : 'border-white/30 bg-card hover:bg-accent/30 hover:border-white/40'} ${!hapticsAvailable ? 'cursor-not-allowed opacity-80' : ''}`}
            >
              {rumble && hapticsAvailable ? (
                <RumbleIcon className="size-8 shrink-0" />
              ) : (
                <RumbleOffIcon className="size-8 shrink-0 opacity-70" />
              )}
              <span
                className={`text-xs font-semibold leading-none ${!rumble || !hapticsAvailable ? 'opacity-70' : ''}`}
              >
                Game Vibration
              </span>
              <span
                className={`text-[10px] font-medium leading-none tracking-wide text-muted-foreground ${!rumble || !hapticsAvailable ? 'opacity-70' : ''}`}
              >
                Rumble
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                const next = !sound;
                setSound(next);
                feedback.setPreferences({ sound: next });
              }}
              aria-pressed={sound}
              aria-label="Toggle button sounds"
              className={`relative flex flex-col items-center justify-center gap-1 rounded-xl border bg-card p-3 pt-4 pb-3 text-center shadow-sm transition-colors active:scale-[0.97] ${sound ? 'border-white/15 bg-primary/10 hover:border-white/20' : 'border-white/30 bg-card hover:bg-accent/30 hover:border-white/40'}`}
            >
              {sound ? (
                <Volume2 className="size-7 shrink-0" />
              ) : (
                <VolumeOff className="size-7 shrink-0 opacity-70" />
              )}
              <span
                className={`text-xs font-semibold leading-none ${!sound ? 'opacity-70' : ''}`}
              >
                Button sounds
              </span>
              <span
                className={`text-[10px] font-medium leading-none tracking-wide text-muted-foreground ${!sound ? 'opacity-70' : ''}`}
              >
                Audio Haptics
              </span>
            </button>
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
                <Slider
                  className="w-full"
                  value={[vibrationMs]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(value) => {
                    const next = Array.isArray(value)
                      ? (value[0] ?? 0)
                      : ((value as number) ?? 0);
                    setVibrationMs(next);
                    feedback.setPreferences({ pressVibrationMs: next });
                  }}
                  onValueCommitted={(value) => {
                    const next = Array.isArray(value)
                      ? (value[0] ?? 0)
                      : ((value as number) ?? 0);
                    previewVibration(next);
                  }}
                />
              </div>
              <div className="grid grid-cols-[1fr_auto_135px] sm:grid-cols-[1fr_auto_165px] items-center gap-2">
                <span className="text-sm font-medium">Joystick press</span>
                <span className="w-11 text-right text-sm font-semibold tabular-nums whitespace-nowrap">
                  {formatVibration(joystickPressMs)}
                </span>
                <Slider
                  className="w-full"
                  value={[joystickPressMs]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(value) => {
                    const next = Array.isArray(value)
                      ? (value[0] ?? 0)
                      : ((value as number) ?? 0);
                    setJoystickPressMs(next);
                    feedback.setPreferences({ joystickPressMs: next });
                  }}
                  onValueCommitted={(value) => {
                    const next = Array.isArray(value)
                      ? (value[0] ?? 0)
                      : ((value as number) ?? 0);
                    previewVibration(next);
                  }}
                />
              </div>
              <div className="grid grid-cols-[1fr_auto_135px] sm:grid-cols-[1fr_auto_165px] items-center gap-2">
                <span className="text-sm font-medium">Joystick at Edge</span>
                <span className="w-11 text-right text-sm font-semibold tabular-nums whitespace-nowrap">
                  {formatVibration(joystickEdgeMs)}
                </span>
                <Slider
                  className="w-full"
                  value={[joystickEdgeMs]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(value) => {
                    const next = Array.isArray(value)
                      ? (value[0] ?? 0)
                      : ((value as number) ?? 0);
                    setJoystickEdgeMs(next);
                    feedback.setPreferences({ joystickEdgeMs: next });
                  }}
                  onValueCommitted={(value) => {
                    const next = Array.isArray(value)
                      ? (value[0] ?? 0)
                      : ((value as number) ?? 0);
                    previewVibration(next);
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
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
