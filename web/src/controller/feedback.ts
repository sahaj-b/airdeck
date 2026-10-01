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
  document?: Document;
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

// Intensity emulation, copied from web-haptics (MIT) instead of depending
// on it. navigator.vibrate has no amplitude knob, it only takes on/off
// durations, so intensity is faked with software PWM. iOS Safari has no
// vibrate at all, so it gets a hidden checkbox switch tick instead.
// Both tricks are perceptual, the motor always fires at full power.
export const PWM_CYCLE_MS = 20;
export const IOS_TOGGLE_MIN_MS = 16;
export const IOS_TOGGLE_RANGE_MS = 184;
export const XBOX_RUMBLE_MAX = 65535;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

// Xbox sends two motors, strong low-freq plus weak high-freq, each 0-65535.
// Phones have one motor, so collapse to a single 0-1 knob. Strong wins
// outright, weak contributes scaled so a weak-only effect still reads.
export function rumbleToIntensity(strong: number, weak: number): number {
  const s = clamp01(strong / XBOX_RUMBLE_MAX);
  const w = clamp01(weak / XBOX_RUMBLE_MAX);
  return clamp01(Math.max(s, w * 0.6));
}

// Chop a duration into on/off slices for navigator.vibrate. Intensity 1
// passes through untouched, intensity 0 is silence. Example: 100ms at 0.5
// becomes [10,10,10,10,10,10,10,10,10,10] with a 20ms cycle.
export function modulateVibration(
  duration: number,
  intensity: number,
): number[] {
  const level = clamp01(intensity);
  if (level >= 1) return [duration];
  if (level <= 0 || duration <= 0) return [];
  const onTime = Math.max(1, Math.round(PWM_CYCLE_MS * level));
  const offTime = PWM_CYCLE_MS - onTime;
  const result: number[] = [];
  let remaining = duration;
  while (remaining >= PWM_CYCLE_MS) {
    result.push(onTime);
    result.push(offTime);
    remaining -= PWM_CYCLE_MS;
  }
  if (remaining > 0) {
    const remOn = Math.max(1, Math.round(remaining * level));
    result.push(remOn);
    const remOff = remaining - remOn;
    if (remOff > 0) result.push(remOff);
  }
  return result.filter((n) => n > 0);
}

// iOS switch tick rate. Faster toggling reads as stronger, same fixed thock
// every time. 1.0 clicks every frame, 0.5 about every 100ms, 0.0 about
// every 200ms.
export function iosToggleIntervalMs(intensity: number): number {
  return IOS_TOGGLE_MIN_MS + (1 - clamp01(intensity)) * IOS_TOGGLE_RANGE_MS;
}

export class FeedbackController {
  private readonly currentNavigator: NavigatorWithVibration;
  private readonly currentWindow: FeedbackOptions['window'];
  private readonly currentDocument: Document | undefined;
  private preferences: FeedbackPreferences;
  private audio: AudioContextLike | undefined;
  private rumbleActive = false;
  private rumbleIntensity = 0;

  private rumbleTimer: ReturnType<typeof setInterval> | undefined;
  private rumbleSince = 0;
  private hapticLabel: HTMLLabelElement | null = null;
  private iosTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(preferences: FeedbackPreferences, options: FeedbackOptions = {}) {
    this.currentNavigator = options.navigator ?? navigator;
    this.currentWindow =
      options.window ?? (typeof window === 'undefined' ? undefined : window);
    this.currentDocument =
      options.document ??
      (typeof document === 'undefined' ? undefined : document);
    this.preferences = {
      joystickPressMs: JOYSTICK_EDGE_VIBRATION_MS,
      joystickEdgeMs: JOYSTICK_EDGE_VIBRATION_MS,
      ...preferences,
    };
  }

  private hasTouch(): boolean {
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

  get androidAvailable(): boolean {
    if (typeof this.currentNavigator.vibrate !== 'function') return false;
    return this.hasTouch();
  }

  get iosAvailable(): boolean {
    // iOS Safari never implemented navigator.vibrate. Touch device without
    // vibrate is almost always an iPhone on iOS 18+, where the hidden
    // switch tick works. Skipping when vibrate exists keeps Android on the
    // vibrate path instead of pointlessly building switch DOM.
    if (typeof this.currentNavigator.vibrate === 'function') return false;
    return this.hasTouch();
  }

  get hapticsAvailable(): boolean {
    return this.androidAvailable || this.iosAvailable;
  }

  setPreferences(preferences: Partial<FeedbackPreferences>): void {
    this.preferences = { ...this.preferences, ...preferences };
    if (!this.preferences.rumble) this.stopRumble();
  }

  press(): void {
    // A held game rumble owns the single vibration channel; a press buzz
    // would truncate it, so only buzz while the game is silent.
    if (!this.rumbleActive && this.preferences.pressVibrationMs > 0) {
      if (this.androidAvailable)
        this.vibrateAndroid(this.preferences.pressVibrationMs);
      if (this.iosAvailable) this.iosTick();
    }
    void this.playClick();
  }

  joystickPress(): void {
    if (this.rumbleActive) return;
    const ms = this.preferences.joystickPressMs ?? 0;
    if (ms <= 0) return;
    if (this.androidAvailable) this.vibrateAndroid(ms);
    if (this.iosAvailable) this.iosTick();
    void this.playClick();
  }

  joystickEdge(): void {
    // tap when the stick hits the rim. Hysteresis is handled by the caller,
    // this just respects the same guards as press: no buzz during a held
    // game rumble.
    if (this.rumbleActive) return;
    const ms = this.preferences.joystickEdgeMs ?? 0;
    if (ms <= 0) return;
    if (this.androidAvailable) this.vibrateAndroid(ms);
    if (this.iosAvailable) this.iosTick();
  }

  previewVibration(ms: number): void {
    // Slider preview in settings. Same guards as press so a held rumble
    // never gets truncated by fiddling with settings.
    if (this.rumbleActive || ms <= 0) return;
    if (this.androidAvailable) this.vibrateAndroid(ms);
    if (this.iosAvailable) this.iosTick();
  }

  rumble(message: Rumble): void {
    ffTrace(
      `[ff] rumble() active=${message.active} strong=${message.strong} weak=${message.weak} pref=${this.preferences.rumble} haptics=${this.hapticsAvailable} alreadyActive=${this.rumbleActive}`,
    );
    if (!this.preferences.rumble || !this.hapticsAvailable) return;
    if (!message.active) {
      this.stopRumble();
      return;
    }
    const intensity = rumbleToIntensity(message.strong, message.weak);
    if (intensity <= 0) {
      this.stopRumble();
      return;
    }
    // Re-arm immediately on every START and refresh the failsafe clock.
    // The interval below keeps the chunks coming while held.
    this.rumbleActive = true;
    this.rumbleIntensity = intensity;
    this.rumbleSince = Date.now();
    if (this.androidAvailable) {
      if (intensity >= 1) this.vibrateAndroid(RUMBLE_CHUNK_MS);
      else this.vibrateAndroid(modulateVibration(RUMBLE_CHUNK_MS, intensity));
    }
    if (this.iosAvailable) {
      this.iosTick();
      this.scheduleIosRumble();
    }
    this.ensureRumbleTimer();
  }

  stopRumble(): void {
    ffTrace(`[ff] stopRumble() wasActive=${this.rumbleActive}`);
    this.clearIosRumble();
    if (!this.rumbleActive) {
      this.clearRumbleTimer();
      return;
    }
    this.rumbleActive = false;
    this.rumbleIntensity = 0;
    this.clearRumbleTimer();
    // Best-effort precise cancel. On browsers where cancel is broken the
    // motor still ends with the last chunk instead of a clamped 10s buzz.
    // iOS ticks are transient, nothing to cancel, just stop scheduling.
    if (this.androidAvailable) this.vibrateAndroid(0);
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
      // Android re-arm with current intensity. iOS ticks run on their own
      // faster chain, the failsafe above still guards a lost STOP for both.
      if (this.androidAvailable) {
        if (this.rumbleIntensity >= 1) this.vibrateAndroid(RUMBLE_CHUNK_MS);
        else
          this.vibrateAndroid(
            modulateVibration(RUMBLE_CHUNK_MS, this.rumbleIntensity),
          );
      }
    }, RUMBLE_REARM_MS);
  }

  private clearRumbleTimer(): void {
    if (this.rumbleTimer !== undefined) {
      clearInterval(this.rumbleTimer);
      this.rumbleTimer = undefined;
    }
  }

  private scheduleIosRumble(): void {
    this.clearIosRumble();
    if (!this.rumbleActive || !this.iosAvailable) return;
    const delay = iosToggleIntervalMs(this.rumbleIntensity);
    this.iosTimer = setTimeout(() => {
      if (!this.rumbleActive) return;
      this.iosTick();
      this.scheduleIosRumble();
    }, delay);
  }

  private clearIosRumble(): void {
    if (this.iosTimer !== undefined) {
      clearTimeout(this.iosTimer);
      this.iosTimer = undefined;
    }
  }

  destroy(): void {
    this.stopRumble();
    try {
      this.hapticLabel?.remove();
    } catch {
      // Removing debug DOM must never throw into the input path.
    }
    this.hapticLabel = null;
    this.audio = undefined;
  }

  private vibrateAndroid(pattern: number | number[]): void {
    if (!this.androidAvailable) {
      ffTrace(`[ff] vibrate(${pattern}) skipped, no android haptics`);
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

  private ensureHapticDom(): HTMLLabelElement | null {
    if (this.hapticLabel) return this.hapticLabel;
    const doc = this.currentDocument;
    if (!doc?.createElement || !doc.body) return null;
    try {
      const label = doc.createElement('label');
      label.setAttribute('for', 'airdeck-haptics');
      label.setAttribute('aria-hidden', 'true');
      // opacity 0, never display none. Programmatic clicks on display
      // none elements look patched out on newer iOS, opacity 0 keeps the
      // switch alive to the engine while invisible to the player.
      label.style.cssText =
        'position:fixed;left:10px;bottom:10px;opacity:0;pointer-events:none;z-index:9999;';
      const input = doc.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.id = 'airdeck-haptics';
      input.tabIndex = -1;
      input.setAttribute('aria-hidden', 'true');
      label.appendChild(input);
      doc.body.appendChild(label);
      this.hapticLabel = label;
      return label;
    } catch {
      return null;
    }
  }

  private iosTick(): boolean {
    if (!this.iosAvailable) return false;
    const label = this.ensureHapticDom();
    if (!label) {
      ffTrace('[ff] iosTick skipped, no DOM');
      return false;
    }
    try {
      label.click();
      ffTrace(
        `[ff] iosTick intensity=${this.rumbleActive ? this.rumbleIntensity.toFixed(2) : 'press'}`,
      );
      return true;
    } catch (err) {
      ffTrace(`[ff] iosTick threw ${String(err)}`);
      return false;
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
