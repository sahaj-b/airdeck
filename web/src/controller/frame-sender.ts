import { encodeFrame } from '../shared/frame';
import type { InputState, InputStateStore } from './state';

export interface BinaryTransport {
  sendBinary(frame: Uint8Array): boolean;
}

export const DEFAULT_INPUT_RATE = 60;

export class FrameSender {
  private sequence = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private inputRate: number;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly transport: BinaryTransport,
    private readonly state: InputStateStore,
    inputRate = DEFAULT_INPUT_RATE,
  ) {
    this.inputRate = normalizeRate(inputRate);
    this.unsubscribe = state.subscribe((snapshot) => {
      if (this.running) this.sendNow(snapshot);
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.sendNow();
    this.schedule();
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
    if (!this.running) return false;
    const state = snapshot ?? this.state.state;
    const frame = encodeFrame({ ...state, seq: this.sequence });
    if (!this.transport.sendBinary(frame)) return false;
    this.sequence = (this.sequence + 1) >>> 0;
    return true;
  }

  private schedule(): void {
    const interval = 1000 / this.inputRate;
    this.timer = setInterval(() => this.sendNow(), interval);
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

function normalizeRate(inputRate: number): number {
  return Number.isFinite(inputRate)
    ? Math.max(1, inputRate)
    : DEFAULT_INPUT_RATE;
}
