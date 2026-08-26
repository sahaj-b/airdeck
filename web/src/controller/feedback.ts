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

type NavigatorWithVibration = Navigator & {
  vibrate?: (pattern: number | number[]) => boolean;
};

export interface FeedbackPreferences {
  haptics: boolean;
  sound: boolean;
}

export interface FeedbackOptions {
  navigator?: NavigatorWithVibration;
  window?: Window & {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
}

export class FeedbackController {
  private readonly currentNavigator: NavigatorWithVibration;
  private readonly currentWindow: FeedbackOptions['window'];
  private preferences: FeedbackPreferences;
  private audio: AudioContextLike | undefined;
  private rumbleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(preferences: FeedbackPreferences, options: FeedbackOptions = {}) {
    this.currentNavigator = options.navigator ?? navigator;
    this.currentWindow = options.window ?? window;
    this.preferences = { ...preferences };
  }

  get hapticsAvailable(): boolean {
    return typeof this.currentNavigator.vibrate === 'function';
  }

  setPreferences(preferences: Partial<FeedbackPreferences>): void {
    this.preferences = { ...this.preferences, ...preferences };
    if (!this.preferences.haptics) this.stopRumble();
  }

  press(): void {
    this.vibrate(10);
    this.playClick();
  }

  rumble(message: Rumble): void {
    if (!this.preferences.haptics || !this.hapticsAvailable) return;
    if (!message.active) {
      this.stopRumble();
      return;
    }
    const strength = Math.max(message.strong, message.weak) / 65535;
    const duration = Math.max(10, Math.round(10 + strength * 50));
    this.vibrate(duration);
    if (this.rumbleTimer !== undefined) clearTimeout(this.rumbleTimer);
    this.rumbleTimer = setTimeout(() => {
      this.rumbleTimer = undefined;
      this.vibrate(0);
    }, duration);
  }

  stopRumble(): void {
    if (this.rumbleTimer !== undefined) {
      clearTimeout(this.rumbleTimer);
      this.rumbleTimer = undefined;
    }
    this.vibrate(0);
  }

  destroy(): void {
    this.stopRumble();
    this.audio = undefined;
  }

  private vibrate(pattern: number): void {
    if (!this.preferences.haptics || !this.hapticsAvailable) return;
    try {
      this.currentNavigator.vibrate?.(pattern);
    } catch {
      // Browser feedback must never enter the input failure path.
    }
  }

  private playClick(): void {
    if (!this.preferences.sound) return;
    try {
      const AudioContext =
        this.currentWindow?.AudioContext ??
        this.currentWindow?.webkitAudioContext;
      if (!AudioContext) return;
      this.audio ??= new AudioContext();
      if (this.audio.state === 'suspended')
        void this.audio.resume().catch(() => undefined);
      const oscillator = this.audio.createOscillator();
      const gain = this.audio.createGain();
      const now = this.audio.currentTime;
      oscillator.type = 'sine';
      oscillator.frequency.value = 220;
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
      oscillator.connect(gain);
      gain.connect(this.audio.destination);
      oscillator.start();
      oscillator.stop(now + 0.04);
    } catch {
      // A denied audio context must not interrupt touch handling.
    }
  }
}
