import { describe, expect, it } from 'vitest';
import { isValidRoomCode, normalizeRoomCode } from './storage';

describe('room codes', () => {
  it('normalizes case, dashes, and spaces before lookup', () => {
    expect(normalizeRoomCode(' ab-cd 12 ')).toBe('ABCD12');
    expect(normalizeRoomCode('gate-22')).toBe('GATE22');
    expect(normalizeRoomCode('a b\tc-d')).toBe('ABCD');
  });

  it('accepts generated and custom codes from the room alphabet', () => {
    expect(isValidRoomCode('GATE22')).toBe(true);
    expect(isValidRoomCode('gate-22')).toBe(true);
    expect(isValidRoomCode('abcd-efgh-2345-6789-jkmn')).toBe(true);
    expect(isValidRoomCode('ABCD')).toBe(true);
  });

  it('rejects ambiguous chars, bad lengths, and legacy digits', () => {
    // 0/O, 1/I/L are ambiguous and never validate.
    expect(isValidRoomCode('GATE01')).toBe(false);
    expect(isValidRoomCode('GATEOI')).toBe(false);
    expect(isValidRoomCode('GATEIL')).toBe(false);
    // Bounds are 4-24 after normalization.
    expect(isValidRoomCode('ABC')).toBe(false);
    expect(isValidRoomCode('A'.repeat(25))).toBe(false);
    expect(isValidRoomCode('')).toBe(false);
    expect(isValidRoomCode('AB!D')).toBe(false);
  });
});
