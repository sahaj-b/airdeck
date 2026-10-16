import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameSender } from './frame-sender';
import { InputStateStore } from './state';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FrameSender', () => {
  it('sends a complete frame immediately and coalesces a change into the next tick', () => {
    const frames: Uint8Array[] = [];
    const sender = new FrameSender(
      {
        sendBinary: (frame) => {
          frames.push(frame);
          return true;
        },
      },
      new InputStateStore(),
      60,
    );
    const state = new InputStateStore();
    const senderWithState = new FrameSender(
      {
        sendBinary: (frame) => {
          frames.push(frame);
          return true;
        },
      },
      state,
    );

    sender.start();
    sender.stop();
    sender.destroy();
    senderWithState.start();
    // Same-ms change is throttled: start took the leading slot, the button
    // press coalesces into the next 16ms tick with the freshest state.
    state.setButton('touch', 'south', true);
    expect(frames).toHaveLength(2);
    vi.advanceTimersByTime(17);
    senderWithState.stop();
    senderWithState.destroy();

    expect(frames).toHaveLength(3);
    expect(frames[0]?.[0]).toBe(1);
    expect(frames[0]?.[2]).toBe(0);
    expect(frames[2]?.[2]).toBe(1);
    expect(frames[2]?.[6]).toBe(1);
  });

  it('does not consume a sequence number when the transport is closed', () => {
    const sendBinary = vi.fn(() => false);
    const sender = new FrameSender({ sendBinary }, new InputStateStore());
    sender.start();
    sender.stop();
    sender.destroy();

    const frames: Uint8Array[] = [];
    const activeSender = new FrameSender(
      {
        sendBinary: (frame) => {
          frames.push(frame);
          return true;
        },
      },
      new InputStateStore(),
    );
    activeSender.start();
    activeSender.stop();
    activeSender.destroy();
    expect(frames[0]?.[2]).toBe(0);
  });

  it('coalesces a joystick burst into one tick frame', () => {
    const frames: Uint8Array[] = [];
    const state = new InputStateStore();
    const sender = new FrameSender(
      {
        sendBinary: (frame) => {
          frames.push(frame);
          return true;
        },
      },
      state,
      60,
    );
    sender.start();
    expect(frames).toHaveLength(1);
    for (let i = 1; i <= 10; i += 1) {
      state.setStick('touch', 'leftStick', i / 10, 0);
    }
    // All 10 moves landed in the same ms: nothing extra sent yet.
    expect(frames).toHaveLength(1);
    vi.advanceTimersByTime(17);
    // One tick carries the freshest stick value, not 10 queued frames.
    expect(frames).toHaveLength(2);
    sender.stop();
    sender.destroy();
  });

  it('caps sustained movement at the input rate', () => {
    let sends = 0;
    const state = new InputStateStore();
    const sender = new FrameSender(
      {
        sendBinary: () => {
          sends += 1;
          return true;
        },
      },
      state,
      60,
    );
    sender.start();
    expect(sends).toBe(1);
    // Wiggle the stick every 2ms for 100ms: ~50 state changes.
    for (let t = 0; t < 100; t += 2) {
      vi.advanceTimersByTime(2);
      state.setStick('touch', 'leftStick', Math.sin(t / 10), Math.cos(t / 10));
    }
    // 100ms at 60Hz is ~6 interval frames plus start, never 50.
    expect(sends).toBeLessThanOrEqual(8);
    expect(sends).toBeGreaterThanOrEqual(5);
    sender.stop();
    sender.destroy();
  });
});
