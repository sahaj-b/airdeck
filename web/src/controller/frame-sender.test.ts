import { describe, expect, it, vi } from 'vitest';
import { FrameSender } from './frame-sender';
import { InputStateStore } from './state';

describe('FrameSender', () => {
  it('sends a complete frame immediately and after each state change', () => {
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
    state.setButton('touch', 'south', true);
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
});
