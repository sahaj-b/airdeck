import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rumble } from '../shared/contracts';
import {
  FeedbackController,
  RUMBLE_CHUNK_MS,
  RUMBLE_MAX_HOLD_MS,
  RUMBLE_REARM_MS,
  type FeedbackOptions,
  type NavigatorWithVibration,
} from './feedback';

const RUMBLE_START: Rumble = {
  type: 'rumble',
  strong: 65535,
  weak: 65535,
  active: true,
};
const RUMBLE_STOP: Rumble = {
  type: 'rumble',
  strong: 0,
  weak: 0,
  active: false,
};

function createNavigator(
  vibrate: (pattern: number | number[]) => boolean = () => true,
): NavigatorWithVibration {
  return { vibrate, maxTouchPoints: 1 } as unknown as NavigatorWithVibration;
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state = 'running';
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  oscillators: { frequency: { value: number } }[] = [];
  createOscillator = vi.fn(() => {
    const oscillator = {
      type: 'sine',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.oscillators.push(oscillator);
    return oscillator;
  });
  createGain = vi.fn(() => ({
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  }));

  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

function createWindow(): FeedbackOptions['window'] {
  return {
    AudioContext: FakeAudioContext,
  } as unknown as FeedbackOptions['window'];
}

describe('FeedbackController', () => {
  beforeEach(() => {
    FakeAudioContext.instances = [];
  });

  it('holds vibration in chunks and cancels on stop', () => {
    const vibrate = vi.fn();
    const feedback = new FeedbackController(
      { pressVibrationMs: 40, rumble: true, sound: false },
      { navigator: createNavigator(vibrate) },
    );

    feedback.rumble(RUMBLE_START);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenLastCalledWith(RUMBLE_CHUNK_MS);

    // A second START (effect re-upload) re-arms immediately.
    feedback.rumble(RUMBLE_START);
    expect(vibrate).toHaveBeenCalledTimes(2);
    expect(vibrate).toHaveBeenLastCalledWith(RUMBLE_CHUNK_MS);

    feedback.rumble(RUMBLE_STOP);
    expect(vibrate).toHaveBeenLastCalledWith(0);
    feedback.destroy();
  });

  it('re-arms chunks while held so long rumbles survive the clamp', () => {
    vi.useFakeTimers();
    try {
      const vibrate = vi.fn();
      const feedback = new FeedbackController(
        { pressVibrationMs: 40, rumble: true, sound: false },
        { navigator: createNavigator(vibrate) },
      );
      feedback.rumble(RUMBLE_START);
      expect(vibrate).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(RUMBLE_REARM_MS);
      expect(vibrate).toHaveBeenCalledTimes(2);
      expect(vibrate).toHaveBeenLastCalledWith(RUMBLE_CHUNK_MS);
      feedback.rumble(RUMBLE_STOP);
      expect(vibrate).toHaveBeenLastCalledWith(0);
      const calls = vibrate.mock.calls.length;
      vi.advanceTimersByTime(RUMBLE_REARM_MS * 3);
      expect(vibrate.mock.calls.length).toBe(calls);
      feedback.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('failsafes a lost STOP instead of buzzing forever', () => {
    vi.useFakeTimers();
    try {
      const vibrate = vi.fn();
      const feedback = new FeedbackController(
        { pressVibrationMs: 40, rumble: true, sound: false },
        { navigator: createNavigator(vibrate) },
      );
      feedback.rumble(RUMBLE_START);
      vi.advanceTimersByTime(RUMBLE_MAX_HOLD_MS + RUMBLE_REARM_MS * 2);
      expect(vibrate).toHaveBeenLastCalledWith(0);
      const calls = vibrate.mock.calls.length;
      vi.advanceTimersByTime(RUMBLE_REARM_MS * 5);
      expect(vibrate.mock.calls.length).toBe(calls);
      feedback.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a repeated START refreshes the failsafe clock', () => {
    vi.useFakeTimers();
    try {
      const vibrate = vi.fn();
      const feedback = new FeedbackController(
        { pressVibrationMs: 40, rumble: true, sound: false },
        { navigator: createNavigator(vibrate) },
      );
      feedback.rumble(RUMBLE_START);
      vi.advanceTimersByTime(RUMBLE_MAX_HOLD_MS - RUMBLE_REARM_MS);
      feedback.rumble(RUMBLE_START);
      vi.advanceTimersByTime(RUMBLE_REARM_MS * 2);
      expect(vibrate).not.toHaveBeenLastCalledWith(0);
      feedback.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('buzzes on button press when the game is silent', () => {
    const vibrate = vi.fn();
    const feedback = new FeedbackController(
      { pressVibrationMs: 50, rumble: true, sound: false },
      { navigator: createNavigator(vibrate) },
    );

    feedback.press();
    expect(vibrate).toHaveBeenCalledWith(50);
  });

  it('uses the configured press vibration duration', () => {
    const vibrate = vi.fn();
    const feedback = new FeedbackController(
      { pressVibrationMs: 70, rumble: true, sound: false },
      { navigator: createNavigator(vibrate) },
    );

    feedback.press();
    expect(vibrate).toHaveBeenCalledWith(70);
  });

  it('does not let a button press truncate a held game rumble', () => {
    const vibrate = vi.fn();
    const feedback = new FeedbackController(
      { pressVibrationMs: 40, rumble: true, sound: false },
      { navigator: createNavigator(vibrate) },
    );
    feedback.rumble(RUMBLE_START);
    vibrate.mockClear();

    feedback.press();
    expect(vibrate).not.toHaveBeenCalled();

    feedback.stopRumble();
    expect(vibrate).toHaveBeenCalledWith(0);
  });

  it('plays a click when sound is enabled', () => {
    const feedback = new FeedbackController(
      { pressVibrationMs: 0, rumble: false, sound: true },
      { window: createWindow() },
    );

    feedback.press();
    const context = FakeAudioContext.instances.at(-1);
    expect(context?.oscillators).toHaveLength(1);
    expect(context?.oscillators[0].frequency.value).toBe(660);
  });

  it('still rumbles when press vibration is off', () => {
    const vibrate = vi.fn();
    const feedback = new FeedbackController(
      { pressVibrationMs: 0, rumble: true, sound: false },
      { navigator: createNavigator(vibrate) },
    );

    feedback.press();
    expect(vibrate).not.toHaveBeenCalled();

    feedback.rumble(RUMBLE_START);
    expect(vibrate).toHaveBeenCalledWith(RUMBLE_CHUNK_MS);
    feedback.destroy();
  });

  it('skips vibration entirely when press vibration and rumble are off', () => {
    const vibrate = vi.fn();
    const feedback = new FeedbackController(
      { pressVibrationMs: 0, rumble: false, sound: false },
      { navigator: createNavigator(vibrate) },
    );

    feedback.press();
    feedback.rumble(RUMBLE_START);
    expect(vibrate).not.toHaveBeenCalled();
  });
});
