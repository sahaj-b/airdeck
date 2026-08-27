import type { Capabilities } from '../shared/contracts';

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

interface OrientationLike {
  lock?(orientation: 'landscape'): Promise<void>;
}

export type NavigatorCapabilities = Omit<Navigator, 'vibrate' | 'wakeLock'> & {
  wakeLock?: WakeLockLike;
  vibrate?: (pattern: number | number[]) => boolean;
};

export interface CapabilityStatus extends Capabilities {
  messages: string[];
}

export interface CapabilityManagerOptions {
  onStatus?: (status: CapabilityStatus) => void;
  document?: Document;
  navigator?: NavigatorCapabilities;
  screen?: Screen & { orientation?: OrientationLike };
  window?: Window;
}

function browserNavigator(
  options: CapabilityManagerOptions,
): NavigatorCapabilities {
  return options.navigator ?? navigator;
}

function browserDocument(options: CapabilityManagerOptions): Document {
  return options.document ?? document;
}

function browserScreen(options: CapabilityManagerOptions): Screen & {
  orientation?: OrientationLike;
} {
  return options.screen ?? screen;
}

function browserWindow(options: CapabilityManagerOptions): Window | undefined {
  return options.window ?? (typeof window === 'undefined' ? undefined : window);
}

function hasHapticsHardware(nav: NavigatorCapabilities, win?: Window): boolean {
  if (typeof nav.vibrate !== 'function') return false;
  const coarse = win?.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  const touchPoints =
    (nav as unknown as { maxTouchPoints?: number }).maxTouchPoints ?? 0;
  const hasTouch = touchPoints > 0 || (win != null && 'ontouchstart' in win);
  return hasTouch || coarse;
}

export function detectCapabilities(
  options: CapabilityManagerOptions = {},
): CapabilityStatus {
  const currentNavigator = browserNavigator(options);
  const currentDocument = browserDocument(options);
  const currentScreen = browserScreen(options);
  const currentWindow = browserWindow(options);
  return {
    sound:
      currentWindow !== undefined &&
      ('AudioContext' in currentWindow ||
        'webkitAudioContext' in currentWindow),
    wakeLock: typeof currentNavigator.wakeLock?.request === 'function',
    fullscreen:
      typeof currentDocument.documentElement.requestFullscreen === 'function',
    orientation: typeof currentScreen.orientation?.lock === 'function',
    messages: [],
  };
}

export class CapabilityManager {
  private status: CapabilityStatus;
  private wakeLock: WakeLockSentinelLike | undefined;
  private joined = false;
  private wakeLockEnabled = true;
  private readonly currentDocument: Document;
  private readonly currentNavigator: NavigatorCapabilities;
  private readonly currentScreen: Screen & { orientation?: OrientationLike };
  private readonly onStatus?: (status: CapabilityStatus) => void;

  constructor(options: CapabilityManagerOptions = {}) {
    this.currentDocument = browserDocument(options);
    this.currentNavigator = browserNavigator(options);
    this.currentScreen = browserScreen(options);
    this.onStatus = options.onStatus;
    this.status = detectCapabilities(options);
    this.currentDocument.addEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    );
    this.publish();
  }

  get capabilities(): Capabilities {
    const { messages: _messages, ...capabilities } = this.status;
    return capabilities;
  }

  get currentStatus(): CapabilityStatus {
    return { ...this.status, messages: [...this.status.messages] };
  }

  setWakeLockPreference(enabled: boolean): void {
    this.wakeLockEnabled = enabled;
    if (!enabled) this.releaseWakeLock();
  }

  async requestJoinCapabilities(
    wakeLockEnabled = this.wakeLockEnabled,
  ): Promise<CapabilityStatus> {
    this.joined = true;
    this.wakeLockEnabled = wakeLockEnabled;
    const attempts: Promise<void>[] = [];

    if (this.status.fullscreen) attempts.push(this.requestFullscreen());
    if (this.status.wakeLock && wakeLockEnabled)
      attempts.push(this.requestWakeLock());
    if (this.status.orientation) attempts.push(this.requestOrientation());

    await Promise.allSettled(attempts);
    return this.currentStatus;
  }

  destroy(): void {
    this.joined = false;
    this.currentDocument.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    );
    this.releaseWakeLock();
  }

  private readonly handleVisibilityChange = (): void => {
    if (
      !this.joined ||
      !this.wakeLockEnabled ||
      this.currentDocument.visibilityState !== 'visible'
    ) {
      return;
    }
    if (this.status.wakeLock) void this.requestWakeLock();
  };

  private async requestFullscreen(): Promise<void> {
    try {
      await this.currentDocument.documentElement.requestFullscreen();
    } catch {
      this.fail('fullscreen', 'Fullscreen is unavailable.');
      throw new Error('fullscreen unavailable');
    }
  }

  private async requestOrientation(): Promise<void> {
    try {
      await this.currentScreen.orientation?.lock?.('landscape');
    } catch {
      this.fail('orientation', 'Landscape lock is unavailable.');
      throw new Error('orientation lock unavailable');
    }
  }

  private async requestWakeLock(): Promise<void> {
    try {
      this.releaseWakeLock();
      this.wakeLock = await this.currentNavigator.wakeLock?.request('screen');
    } catch {
      this.fail('wakeLock', 'Screen wake lock is unavailable.');
      throw new Error('wake lock unavailable');
    }
  }

  private releaseWakeLock(): void {
    const sentinel = this.wakeLock;
    this.wakeLock = undefined;
    if (sentinel) void sentinel.release().catch(() => undefined);
  }

  private fail(capability: keyof Capabilities, message: string): void {
    this.status = {
      ...this.status,
      [capability]: false,
      messages: this.status.messages.includes(message)
        ? this.status.messages
        : [...this.status.messages, message],
    };
    this.publish();
  }

  private publish(): void {
    this.onStatus?.(this.currentStatus);
  }
}
