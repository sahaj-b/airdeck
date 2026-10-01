import { encodeFrame } from '../shared/frame';
import type { InputState, InputStateStore } from './state';

export interface BinaryTransport {
  sendBinary(frame: Uint8Array): boolean;
}

export interface FrameSenderStats {
  sent: number;
  coalesced: number;
  dropped: number;
  pps: number;
}

export const DEFAULT_INPUT_RATE = 60;

export class FrameSender {
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private inputRate: number;
  private lastSendMs = 0;
  private sentCount = 0;
  private coalescedCount = 0;
  private droppedCount = 0;
  private readonly sendTimes: number[] = [];
  private readonly unsubscribe: () => void;

  constructor(
    private readonly transport: BinaryTransport,
    private readonly state: InputStateStore,
    inputRate = DEFAULT_INPUT_RATE,
  ) {
    this.inputRate = normalizeRate(inputRate);
    this.unsubscribe = state.subscribe(() => {
      if (this.running) this.sendThrottled();
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastSendMs = 0;
    this.flush();
  }

  get isRunning(): boolean {
    return this.running;
  }

  setInputRate(inputRate: number): void {
    this.inputRate = normalizeRate(inputRate);
    if (this.running) {
      this.clearTimer();
      this.schedule();
    }
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
  }

  destroy(): void {
    this.stop();
    this.unsubscribe();
  }

  sendNow(snapshot?: InputState): boolean {
    return this.flush(snapshot);
  }

  getStats(): FrameSenderStats {
    const now = Date.now();
    while (this.sendTimes.length > 0) {
      const oldest = this.sendTimes[0];
      if (oldest === undefined || now - oldest <= 1000) break;
      this.sendTimes.shift();
    }
    return {
      sent: this.sentCount,
      coalesced: this.coalescedCount,
      dropped: this.droppedCount,
      pps: this.sendTimes.length,
    };
  }

  private sendThrottled(): void {
    if (Date.now() - this.lastSendMs >= this.intervalMs()) {
      this.flush();
      return;
    }
    this.coalescedCount += 1;
    if (this.timer === undefined) {
      const wait = Math.max(
        0,
        this.intervalMs() - (Date.now() - this.lastSendMs),
      );
      this.timer = setTimeout(() => this.onTick(), wait);
    }
  }

  private flush(snapshot?: InputState): boolean {
    if (!this.running) return false;
    const state = snapshot ?? this.state.state;
    const frame = encodeFrame({ ...state, seq: this.sequence });
    if (!this.transport.sendBinary(frame)) {
      this.droppedCount += 1;
      if (this.timer === undefined) this.schedule();
      return false;
    }
    this.sequence = (this.sequence + 1) >>> 0;
    this.lastSendMs = Date.now();
    this.sentCount += 1;
    this.sendTimes.push(this.lastSendMs);
    if (this.sendTimes.length > 240) this.sendTimes.shift();
    this.clearTimer();
    this.schedule();
    return true;
  }

  private onTick(): void {
    this.timer = undefined;
    if (!this.running) return;
    this.flush();
  }

  private intervalMs(): number {
    return 1000 / this.inputRate;
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => this.onTick(), this.intervalMs());
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function normalizeRate(inputRate: number): number {
  return Number.isFinite(inputRate)
    ? Math.max(1, inputRate)
    : DEFAULT_INPUT_RATE;
}
