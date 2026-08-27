export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function applyDeadzoneAndScale(
  normalized: number,
  deadzone: number,
): number {
  const zone = clamp(Number.isFinite(deadzone) ? deadzone : 0, 0, 0.99);
  const abs = Math.abs(normalized);
  if (abs <= zone) return 0;
  const scaled = (abs - zone) / (1 - zone);
  return clampUnit(Math.sign(normalized) * Math.min(1, scaled));
}

export function mapTiltToUnit(
  deltaDeg: number,
  deadzone: number,
  maxAngle: number,
): number {
  if (!Number.isFinite(deltaDeg)) return 0;
  const max = Math.max(1, Number.isFinite(maxAngle) ? maxAngle : 35);
  const normalized = clamp(deltaDeg / max, -1, 1);
  return applyDeadzoneAndScale(normalized, deadzone);
}

export function tiltDeltaToStick(
  deltaDeg: number,
  deadzone: number,
  maxAngle: number,
  invert: boolean,
): number {
  const v = mapTiltToUnit(deltaDeg, deadzone, maxAngle);
  const signed = invert ? -v : v;
  return clampUnit(signed);
}
