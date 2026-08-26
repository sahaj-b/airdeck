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

// Browsers clamp a single vibration well below a game-length rumble, so hold
// the pattern for the whole START..STOP span instead of timing out locally.
const RUMBLE_ON_PATTERN = 999999;

export class FeedbackController {
  private readonly currentNavigator: NavigatorWithVibration;
  private readonly currentWindow: FeedbackOptions['window'];
  private preferences: FeedbackPreferences;
  private audio: AudioContextLike | undefined;
  private rumbleActive = false;

  constructor(preferences: FeedbackPreferences, options: FeedbackOptions = {}) {
    this.currentNavigator = options.navigator ?? navigator;
    this.currentWindow =
      options.window ?? (typeof window === 'undefined' ? undefined : window);
    this.preferences = { ...preferences };
  }

  get hapticsAvailable(): boolean {
    return typeof this.currentNavigator.vibrate === 'function';
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

  rumble(message: Rumble): void {
    if (!this.preferences.rumble || !this.hapticsAvailable) return;
    if (!message.active) {
      this.stopRumble();
      return;
    }
    // Re-arm on every START so the buzz survives browsers that clamp a single
    // vibration call; STOP (or zero magnitudes) cancels it.
    this.rumbleActive = true;
    this.vibrate(RUMBLE_ON_PATTERN);
  }

  stopRumble(): void {
    if (!this.rumbleActive) return;
    this.rumbleActive = false;
    this.vibrate(0);
  }

  destroy(): void {
    this.stopRumble();
    this.audio = undefined;
  }

  private vibrate(pattern: number): void {
    if (!this.hapticsAvailable) return;
    try {
      this.currentNavigator.vibrate?.(pattern);
    } catch {
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
      gain.gain.setValueAtTime(0.15, now);
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
