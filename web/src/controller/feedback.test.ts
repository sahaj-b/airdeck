import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rumble } from '../shared/contracts';
import {
  FeedbackController,
  type FeedbackOptions,
  iosToggleIntervalMs,
  modulateVibration,
  type NavigatorWithVibration,
  RUMBLE_CHUNK_MS,
  RUMBLE_MAX_HOLD_MS,
  RUMBLE_REARM_MS,
  rumbleToIntensity,
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

describe('rumbleToIntensity', () => {
  it('maps full strong to 1', () => {
    expect(rumbleToIntensity(65535, 0)).toBe(1);
  });

  it('scales weak-only down so it still reads', () => {
    expect(rumbleToIntensity(0, 65535)).toBeCloseTo(0.6, 5);
    expect(rumbleToIntensity(0, 0)).toBe(0);
  });

  it('strong wins over weak', () => {
    expect(rumbleToIntensity(65535, 65535)).toBe(1);
    expect(rumbleToIntensity(32767, 0)).toBeCloseTo(0.5, 2);
  });
});

describe('modulateVibration', () => {
  it('passes full intensity through untouched', () => {
    expect(modulateVibration(500, 1)).toEqual([500]);
  });

  it('returns silence for zero intensity', () => {
    expect(modulateVibration(500, 0)).toEqual([]);
  });

  it('chops half intensity into 10 on 10 off slices', () => {
    expect(modulateVibration(100, 0.5)).toEqual([
      10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
    ]);
  });

  it('sums back to roughly the requested duration', () => {
    const pattern = modulateVibration(500, 0.3);
    const total = pattern.reduce((sum, n) => sum + n, 0);
    expect(total).toBe(500);
    // on slices are short, off slices dominate at low intensity
    expect(pattern[0]).toBe(6);
    expect(pattern[1]).toBe(14);
  });
});

describe('iosToggleIntervalMs', () => {
  it('clicks every frame at full intensity', () => {
    expect(iosToggleIntervalMs(1)).toBe(16);
  });

  it('slows to ~200ms at zero intensity', () => {
    expect(iosToggleIntervalMs(0)).toBe(200);
  });
});

describe('FeedbackController android PWM', () => {
  it('sends a PWM pattern for weak-only rumble', () => {
    const vibrate = vi.fn();
    const feedback = new FeedbackController(
      { pressVibrationMs: 0, rumble: true, sound: false },
      { navigator: createNavigator(vibrate) },
    );

    feedback.rumble({
      type: 'rumble',
      strong: 0,
      weak: 65535,
      active: true,
    });
    expect(vibrate).toHaveBeenCalledTimes(1);
    const pattern = vibrate.mock.calls[0][0] as number[];
    expect(Array.isArray(pattern)).toBe(true);
    expect(pattern.length).toBeGreaterThan(2);
    feedback.destroy();
  });

  it('stops on active with zero magnitudes', () => {
    const vibrate = vi.fn();
    const feedback = new FeedbackController(
      { pressVibrationMs: 0, rumble: true, sound: false },
      { navigator: createNavigator(vibrate) },
    );

    feedback.rumble(RUMBLE_START);
    vibrate.mockClear();
    feedback.rumble({
      type: 'rumble',
      strong: 0,
      weak: 0,
      active: true,
    });
    expect(vibrate).toHaveBeenCalledWith(0);
    feedback.destroy();
  });
});

describe('FeedbackController iOS switch', () => {
  function createIosOptions(click: ReturnType<typeof vi.fn>) {
    const label = {
      click,
      style: {},
      appendChild: vi.fn(),
      setAttribute: vi.fn(),
      remove: vi.fn(),
    };
    const doc = {
      createElement: vi.fn(() => ({
        click: vi.fn(),
        style: {},
        appendChild: vi.fn(),
        setAttribute: vi.fn(),
        remove: vi.fn(),
        tabIndex: 0,
      })),
      body: { appendChild: vi.fn() },
    } as unknown as Document;
    // First createElement is the label, second is the checkbox input.
    // Patch label creation to return the clickable label.
    let calls = 0;
    (doc.createElement as ReturnType<typeof vi.fn>).mockImplementation(() => {
      calls += 1;
      if (calls === 1) return label;
      return {
        click: vi.fn(),
        style: {},
        appendChild: vi.fn(),
        setAttribute: vi.fn(),
        remove: vi.fn(),
        tabIndex: 0,
      };
    });
    return { doc, label };
  }

  function createIosNavigator() {
    return { maxTouchPoints: 1 } as unknown as NavigatorWithVibration;
  }

  it('reports haptics available on iPhones with no vibrate', () => {
    const click = vi.fn();
    const { doc } = createIosOptions(click);
    const feedback = new FeedbackController(
      { pressVibrationMs: 40, rumble: true, sound: false },
      { navigator: createIosNavigator(), document: doc },
    );
    expect(feedback.androidAvailable).toBe(false);
    expect(feedback.iosAvailable).toBe(true);
    expect(feedback.hapticsAvailable).toBe(true);
    feedback.destroy();
  });

  it('ticks the switch on press', () => {
    const click = vi.fn();
    const { doc } = createIosOptions(click);
    const feedback = new FeedbackController(
      { pressVibrationMs: 40, rumble: true, sound: false },
      { navigator: createIosNavigator(), document: doc },
    );
    feedback.press();
    expect(click).toHaveBeenCalledTimes(1);
    feedback.destroy();
  });

  it('ticks repeatedly while rumble is held then stops', () => {
    vi.useFakeTimers();
    try {
      const click = vi.fn();
      const { doc } = createIosOptions(click);
      const feedback = new FeedbackController(
        { pressVibrationMs: 0, rumble: true, sound: false },
        { navigator: createIosNavigator(), document: doc },
      );
      feedback.rumble(RUMBLE_START);
      expect(click).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(500);
      expect(click.mock.calls.length).toBeGreaterThan(2);
      feedback.rumble(RUMBLE_STOP);
      const calls = click.mock.calls.length;
      vi.advanceTimersByTime(1000);
      expect(click.mock.calls.length).toBe(calls);
      feedback.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not tick press during held rumble', () => {
    const click = vi.fn();
    const { doc } = createIosOptions(click);
    const feedback = new FeedbackController(
      { pressVibrationMs: 40, rumble: true, sound: false },
      { navigator: createIosNavigator(), document: doc },
    );
    feedback.rumble(RUMBLE_START);
    click.mockClear();
    feedback.press();
    expect(click).not.toHaveBeenCalled();
    feedback.destroy();
  });
});
