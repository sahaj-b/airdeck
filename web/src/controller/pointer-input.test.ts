import { describe, expect, it } from 'vitest';
import {
  applyDeadzone,
  clampFloatCenter,
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

  it('slides the drifted base rim-glued and clamps it inside the section', () => {
    const section = { left: 0, top: 0, width: 400, height: 400 };
    const radius = 50;
    const finger = { x: 300, y: 200 };
    const direction = { x: 1, y: 0 };
    const slid = clampFloatCenter(finger, direction, radius, section);
    expect(slid.x).toBeCloseTo(250);
    expect(slid.y).toBeCloseTo(200);
    const driftedRect = {
      left: slid.x - radius,
      top: slid.y - radius,
      width: radius * 2,
      height: radius * 2,
    };
    const thumb = joystickVisualOffset(finger, driftedRect);
    expect(Math.hypot(thumb.x, thumb.y)).toBeCloseTo(1);
    const output = applyDeadzone(thumb.x, thumb.y, 0.12, 1);
    expect(Math.hypot(output.x, output.y)).toBeCloseTo(1);
  });

  it('stops the drifted base at the section wall with output pinned at 1', () => {
    const section = { left: 0, top: 0, width: 200, height: 200 };
    const radius = 50;
    const finger = { x: 500, y: 100 };
    const direction = { x: 1, y: 0 };
    const clamped = clampFloatCenter(finger, direction, radius, section);
    expect(clamped.x).toBe(150);
    expect(clamped.y).toBe(100);
    const driftedRect = {
      left: clamped.x - radius,
      top: clamped.y - radius,
      width: radius * 2,
      height: radius * 2,
    };
    const thumb = joystickVisualOffset(finger, driftedRect);
    expect(Math.hypot(thumb.x, thumb.y)).toBeCloseTo(1);
  });

  it('reports neutral from the drifted center without returning to touchdown', () => {
    const radius = 50;
    const drifted = { x: 250, y: 200 };
    const driftedRect = {
      left: drifted.x - radius,
      top: drifted.y - radius,
      width: radius * 2,
      height: radius * 2,
    };
    const thumb = joystickVisualOffset(drifted, driftedRect);
    expect(thumb).toEqual({ x: 0, y: 0 });
    expect(applyDeadzone(thumb.x, thumb.y, 0.12, 1)).toEqual({ x: 0, y: 0 });
  });
});
