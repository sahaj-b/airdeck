import type { Rumble } from '../shared/contracts';

interface AudioContextLike {
  state: string;
  currentTime: number;
  resume(): Promise<void>;
  createOscillator(): {
    type: OscillatorType;
    frequency: { value: number };
    connect(destination: unknown): void;
    start(): void;
    stop(when?: number): void;
  };
  createGain(): {
    gain: {
      setValueAtTime(value: number, startTime: number): void;
      exponentialRampToValueAtTime(value: number, endTime: number): void;
    };
    connect(destination: unknown): void;
  };
  destination: unknown;
}

type AudioContextConstructor = new () => AudioContextLike;

export type NavigatorWithVibration = Navigator & {
  vibrate?: (pattern: number | number[]) => boolean;
};

export interface FeedbackPreferences {
  pressVibrationMs: number;
  joystickPressMs?: number;
  joystickEdgeMs?: number;
  rumble: boolean;
  sound: boolean;
}

export interface FeedbackOptions {
  navigator?: NavigatorWithVibration;
  window?: Window & {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
}

// On-page FF trace overlay, enabled with ?ffdebug=1. It mirrors the [ff]
// console lines onto the phone screen itself, so the rumble path can be
// read with no USB debugging.
const ffOverlayEnabled =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('ffdebug') === '1';

let ffOverlay: HTMLElement | undefined;

function ffOverlayLine(text: string): void {
  if (!ffOverlayEnabled || typeof document === 'undefined') return;
  if (!ffOverlay) {
    ffOverlay = document.createElement('div');
    ffOverlay.id = 'ff-debug-overlay';
    ffOverlay.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:99999;max-width:92vw;max-height:38vh;overflow:hidden;pointer-events:none;background:rgba(0,0,0,.82);color:#7CFC98;font:11px/1.5 monospace;white-space:pre-wrap;padding:8px 10px;border-radius:8px;';
    document.documentElement.append(ffOverlay);
  }
  const line = document.createElement('div');
  line.textContent = text;
  ffOverlay.append(line);
  while (ffOverlay.children.length > 14) ffOverlay.firstChild?.remove();
}

export function ffTrace(text: string): void {
  console.log(text);
  ffOverlayLine(text);
}

// Game rumble is held in short chunks, never one giant vibration. A huge
// single duration (previously 999999) gets clamped by the OS to ~10s on
// some browsers, and vibrate(0) then fails to cancel it even while
// returning true. Chunks bound the damage: a broken cancel overruns by one
// chunk (~1s) instead of the full clamp, and the re-arm keeps legit long
// rumbles alive past any per-call clamp.
export const RUMBLE_CHUNK_MS = 500;
export const RUMBLE_REARM_MS = 400;
// Failsafe so a lost STOP can never wedge the motor forever. Refreshed by
// every repeated START, which the host keeps sending for held rumbles.
export const RUMBLE_MAX_HOLD_MS = 30_000;
export const JOYSTICK_EDGE_VIBRATION_MS = 35;

export class FeedbackController {
  private readonly currentNavigator: NavigatorWithVibration;
  private readonly currentWindow: FeedbackOptions['window'];
  private preferences: FeedbackPreferences;
  private audio: AudioContextLike | undefined;
  private rumbleActive = false;

  private rumbleTimer: ReturnType<typeof setInterval> | undefined;
  private rumbleSince = 0;

  constructor(preferences: FeedbackPreferences, options: FeedbackOptions = {}) {
    this.currentNavigator = options.navigator ?? navigator;
    this.currentWindow =
      options.window ?? (typeof window === 'undefined' ? undefined : window);
    this.preferences = {
      joystickPressMs: JOYSTICK_EDGE_VIBRATION_MS,
      joystickEdgeMs: JOYSTICK_EDGE_VIBRATION_MS,
      ...preferences,
    };
  }

  get hapticsAvailable(): boolean {
    if (typeof this.currentNavigator.vibrate !== 'function') return false;
    const coarse =
      this.currentWindow?.matchMedia?.('(pointer: coarse)')?.matches ?? false;
    const touchPoints =
      (this.currentNavigator as unknown as { maxTouchPoints?: number })
        .maxTouchPoints ?? 0;
    const hasTouch =
      touchPoints > 0 ||
      (this.currentWindow != null && 'ontouchstart' in this.currentWindow);
    return hasTouch || coarse;
  }

  setPreferences(preferences: Partial<FeedbackPreferences>): void {
    this.preferences = { ...this.preferences, ...preferences };
    if (!this.preferences.rumble) this.stopRumble();
  }

  press(): void {
    // A held game rumble owns the single vibration channel; a press buzz
    // would truncate it, so only buzz while the game is silent.
    if (!this.rumbleActive && this.preferences.pressVibrationMs > 0)
      this.vibrate(this.preferences.pressVibrationMs);
    void this.playClick();
  }

  joystickPress(): void {
    if (this.rumbleActive) return;
    const ms = this.preferences.joystickPressMs ?? 0;
    if (ms <= 0) return;
    this.vibrate(ms);
    void this.playClick();
  }

  joystickEdge(): void {
    // tap when the stick hits the rim. Hysteresis is handled by the caller,
    // this just respects the same guards as press: no buzz during a held
    // game rumble.
    if (this.rumbleActive) return;
    const ms = this.preferences.joystickEdgeMs ?? 0;
    if (ms <= 0) return;
    this.vibrate(ms);
  }

  rumble(message: Rumble): void {
    ffTrace(
      `[ff] rumble() active=${message.active} pref=${this.preferences.rumble} haptics=${this.hapticsAvailable} alreadyActive=${this.rumbleActive}`,
    );
    if (!this.preferences.rumble || !this.hapticsAvailable) return;
    if (!message.active) {
      this.stopRumble();
      return;
    }
    // Re-arm immediately on every START and refresh the failsafe clock.
    // The interval below keeps the chunks coming while held.
    this.rumbleActive = true;
    this.rumbleSince = Date.now();
    this.vibrate(RUMBLE_CHUNK_MS);
    this.ensureRumbleTimer();
  }

  stopRumble(): void {
    ffTrace(`[ff] stopRumble() wasActive=${this.rumbleActive}`);
    if (!this.rumbleActive) {
      this.clearRumbleTimer();
      return;
    }
    this.rumbleActive = false;
    this.clearRumbleTimer();
    // Best-effort precise cancel. On browsers where cancel is broken the
    // motor still ends with the last chunk instead of a clamped 10s buzz.
    this.vibrate(0);
  }

  private ensureRumbleTimer(): void {
    if (this.rumbleTimer !== undefined) return;
    this.rumbleTimer = setInterval(() => {
      if (!this.rumbleActive) {
        this.clearRumbleTimer();
        return;
      }
      if (Date.now() - this.rumbleSince > RUMBLE_MAX_HOLD_MS) {
        this.stopRumble();
        return;
      }
      this.vibrate(RUMBLE_CHUNK_MS);
    }, RUMBLE_REARM_MS);
  }

  private clearRumbleTimer(): void {
    if (this.rumbleTimer !== undefined) {
      clearInterval(this.rumbleTimer);
      this.rumbleTimer = undefined;
    }
  }

  destroy(): void {
    this.stopRumble();
    this.audio = undefined;
  }

  private vibrate(pattern: number): void {
    if (!this.hapticsAvailable) {
      ffTrace(`[ff] vibrate(${pattern}) skipped, no haptics`);
      return;
    }
    try {
      const ok = this.currentNavigator.vibrate?.(pattern);
      ffTrace(`[ff] vibrate(${pattern}) -> ${ok}`);
    } catch (err) {
      ffTrace(`[ff] vibrate(${pattern}) threw ${String(err)}`);
      // Browser feedback must never enter the input failure path.
    }
  }

  private async playClick(): Promise<void> {
    if (!this.preferences.sound) return;
    try {
      const AudioContext =
        this.currentWindow?.AudioContext ??
        this.currentWindow?.webkitAudioContext;
      if (!AudioContext) return;
      this.audio ??= new AudioContext();
      if (this.audio.state === 'suspended') {
        try {
          await this.audio.resume();
        } catch {
          return;
        }
      }
      const oscillator = this.audio.createOscillator();
      const gain = this.audio.createGain();
      const now = this.audio.currentTime;
      oscillator.type = 'sine';
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.7, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      oscillator.connect(gain);
      gain.connect(this.audio.destination);
      oscillator.start();
      oscillator.stop(now + 0.06);
    } catch {
      // A denied audio context must not interrupt touch handling.
    }
  }
}
