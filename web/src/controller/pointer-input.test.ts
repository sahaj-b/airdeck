import { describe, expect, it } from 'vitest';
import {
  applyDeadzone,
  dpadDirection,
  joystickVisualOffset,
  normalizeJoystickPoint,
} from './pointer-input';

describe('pointer input math', () => {
  it('turns the deadzone edge into a smooth full-range axis', () => {
    expect(applyDeadzone(0.06, 0, 0.12)).toEqual({ x: 0, y: 0 });
    expect(applyDeadzone(0.56, 0, 0.12).x).toBeCloseTo(0.5);
    expect(applyDeadzone(2, 0, 0.12)).toEqual({ x: 1, y: 0 });
  });

  it('uses the calibrated center and canonical screen-axis direction', () => {
    const rect = { left: 0, top: 0, width: 200, height: 200 };
    expect(normalizeJoystickPoint({ x: 100, y: 100 }, rect)).toEqual({
      x: 0,
      y: 0,
    });
    expect(normalizeJoystickPoint({ x: 200, y: 100 }, rect).x).toBe(1);
    expect(normalizeJoystickPoint({ x: 100, y: 200 }, rect).y).toBe(1);
  });

  it('tracks the finger 1:1 and clamps the thumb center to the rim', () => {
    const rect = { left: 0, top: 0, width: 200, height: 200 };
    expect(joystickVisualOffset({ x: 110, y: 100 }, rect)).toEqual({
      x: 0.1,
      y: 0,
    });
    expect(joystickVisualOffset({ x: 200, y: 100 }, rect)).toEqual({
      x: 1,
      y: 0,
    });
    expect(joystickVisualOffset({ x: 300, y: 100 }, rect)).toEqual({
      x: 1,
      y: 0,
    });
  });

  it('pins the thumb to the circular rim in corners instead of the square', () => {
    const rect = { left: 0, top: 0, width: 200, height: 200 };
    const corner = joystickVisualOffset({ x: 200, y: 200 }, rect);
    expect(Math.hypot(corner.x, corner.y)).toBeCloseTo(1);
    expect(corner.x).toBeCloseTo(Math.SQRT1_2);
    expect(corner.y).toBeCloseTo(Math.SQRT1_2);
  });

  it('maps the dominant touch axis to the d-pad binding', () => {
    const bindings = {
      up: 'dpadUp' as const,
      down: 'dpadDown' as const,
      left: 'dpadLeft' as const,
      right: 'dpadRight' as const,
    };
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(dpadDirection({ x: 10, y: 50 }, rect, bindings)).toBe('dpadLeft');
    expect(dpadDirection({ x: 50, y: 90 }, rect, bindings)).toBe('dpadDown');
  });

  it('resolves a quadrant-center tap to that quadrant direction', () => {
    const bindings = {
      up: 'dpadUp' as const,
      down: 'dpadDown' as const,
      left: 'dpadLeft' as const,
      right: 'dpadRight' as const,
    };
    const rect = { left: 0, top: 0, width: 300, height: 300 };
    expect(dpadDirection({ x: 50, y: 150 }, rect, bindings)).toBe('dpadLeft');
    expect(dpadDirection({ x: 150, y: 50 }, rect, bindings)).toBe('dpadUp');
    expect(dpadDirection({ x: 250, y: 150 }, rect, bindings)).toBe('dpadRight');
    expect(dpadDirection({ x: 150, y: 250 }, rect, bindings)).toBe('dpadDown');
  });
});
