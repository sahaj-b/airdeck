// Room-code helpers (SPEC v2a Q1). The Go canonical form lives in
// internal/roomcode; this mirrors Normalize/Validate so the join page
// validates before any socket opens and the transport sends canonical
// codes. Generated codes are 6 chars, custom codes 4-24 chars, from the
// Crockford-style alphabet (A-Z minus I/L/O plus 2-9). Normalization:
// trim, uppercase, strip dashes and spaces.

const ROOMCODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase().replace(/[-\s]/g, '');
}

export function isValidRoomCode(code: string): boolean {
  const normalized = normalizeRoomCode(code);
  if (normalized.length < 4 || normalized.length > 24) return false;
  for (const char of normalized) {
    if (!ROOMCODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

export function readBoolean(key: string, fallback: boolean): boolean {
  const value = readStorage(key);
  return value === null ? fallback : value === 'true';
}

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Browser storage is convenience state, not part of joining.
  }
}

export function getSessionCode(): string {
  const raw = new URLSearchParams(window.location.search).get('code') ?? '';
  if (!isValidRoomCode(raw)) return '';
  return normalizeRoomCode(raw);
}
