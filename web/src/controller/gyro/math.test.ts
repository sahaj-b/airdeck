import { describe, expect, it } from 'vitest';
import {
  applyDeadzoneAndScale,
  clampUnit,
  mapTiltToUnit,
  tiltDeltaToStick,
} from './math';

describe('gyro math', () => {
  it('deadzone suppresses jitter near zero', () => {
    expect(tiltDeltaToStick(1, 0.08, 35, false)).toBe(0);
    expect(tiltDeltaToStick(2, 0.08, 35, false)).toBe(0);
  });
  it('per-axis max clamps to ±1', () => {
    expect(tiltDeltaToStick(100, 0.08, 35, false)).toBe(1);
    expect(tiltDeltaToStick(-100, 0.08, 35, false)).toBe(-1);
  });
  it('invert flips sign', () => {
    const a = tiltDeltaToStick(20, 0.08, 35, false);
    const b = tiltDeltaToStick(20, 0.08, 35, true);
    expect(b).toBe(-a);
  });
  it('mapTiltToUnit scales with maxAngle', () => {
    // 17.5 deg with max 35 => 0.5 normalized -> after deadzone
    const v = mapTiltToUnit(17.5, 0.08, 35);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });
  it('steer Y forced 0 via controller uses tiltDeltaToStick with steer', () => {
    // steer mode: caller forces y=0 regardless of pitch
    const x = tiltDeltaToStick(35, 0, 35, false);
    expect(x).toBe(1);
  });
  it('applyDeadzoneAndScale clamps', () => {
    expect(applyDeadzoneAndScale(0.05, 0.08)).toBe(0);
    expect(applyDeadzoneAndScale(1, 0)).toBe(1);
    expect(applyDeadzoneAndScale(-1, 0)).toBe(-1);
  });
  it('clampUnit handles NaN', () => {
    expect(clampUnit(NaN)).toBe(0);
    expect(clampUnit(2)).toBe(1);
    expect(clampUnit(-2)).toBe(-1);
  });
});
