import { describe, expect, it } from 'vitest';
import xboxDefault from '../layouts/xbox-default.json';
import { DEFAULT_LAYOUT, parseLayoutDocument, validateLayout } from './layout';

describe('validateLayout', () => {
  it('accepts the built-in document', () => {
    expect(validateLayout(xboxDefault)).toBe(true);
  });

  it('falls back to the built-in document when a received document is invalid', () => {
    const result = parseLayoutDocument({ schemaVersion: 1 });
    expect(result.layout).toBe(DEFAULT_LAYOUT);
    expect(result.diagnostic).toBeDefined();
  });

  it('rejects duplicate IDs and incomplete D-pad bindings', () => {
    const duplicate = structuredClone(xboxDefault) as typeof xboxDefault;
    duplicate.sections[0].controls[0].id = duplicate.sections[0].controls[1].id;
    expect(validateLayout(duplicate)).toBe(false);

    const incomplete = structuredClone(xboxDefault) as typeof xboxDefault;
    const dpad = incomplete.sections[0].controls.find(
      (control) => control.type === 'dpad',
    );
    if (!dpad || !('bindings' in dpad) || !dpad.bindings) {
      throw new Error('built-in d-pad missing');
    }
    delete (dpad.bindings as Partial<typeof dpad.bindings>).right;
    expect(validateLayout(incomplete)).toBe(false);
  });

  it('allows non-square joysticks for gyro oval and rejects legacy shapes', () => {
    const oval = structuredClone(xboxDefault) as typeof xboxDefault;
    const stick = oval.sections[0].controls.find(
      (control) => control.type === 'joystick',
    );
    if (!stick) throw new Error('built-in joystick missing');
    stick.geometry.size.height = stick.geometry.size.width / 2;
    expect(validateLayout(oval)).toBe(true);

    const shaped = structuredClone(xboxDefault) as typeof xboxDefault;
    shaped.sections[0].controls[0].shape = 'circle' as unknown as string;
    expect(validateLayout(shaped)).toBe(false);

    const pill = structuredClone(xboxDefault) as typeof xboxDefault;
    pill.sections[0].controls[0].shape = 'pill' as unknown as string;
    expect(validateLayout(pill)).toBe(false);

    const round = structuredClone(xboxDefault) as typeof xboxDefault;
    round.sections[0].controls[0].shape = 'round';
    expect(validateLayout(round)).toBe(true);
  });

  it('rejects invalid section relativeWidth and geometry outside a section', () => {
    const invalidSection = structuredClone(xboxDefault) as typeof xboxDefault;
    invalidSection.sections[1].relativeWidth = 0;
    expect(validateLayout(invalidSection)).toBe(false);

    const invalidGeometry = structuredClone(xboxDefault) as typeof xboxDefault;
    invalidGeometry.sections[0].controls[0].geometry.position.x = 2;
    expect(validateLayout(invalidGeometry)).toBe(false);
  });

  it('rejects wrong section count or order and legacy fields', () => {
    const twoSections = structuredClone(xboxDefault) as typeof xboxDefault;
    twoSections.sections = twoSections.sections.slice(
      0,
      2,
    ) as typeof twoSections.sections;
    expect(validateLayout(twoSections)).toBe(false);

    const wrongOrder = structuredClone(xboxDefault) as typeof xboxDefault;
    const tmp = wrongOrder.sections[0];
    const sec1 = wrongOrder.sections[1];
    if (!tmp || !sec1) throw new Error('missing section');
    wrongOrder.sections[0] = sec1;
    wrongOrder.sections[1] = tmp;
    expect(validateLayout(wrongOrder)).toBe(false);

    const legacy = structuredClone(xboxDefault) as unknown as Record<
      string,
      unknown
    >;
    legacy.sections = (legacy.sections as unknown[]).map((s: unknown) => ({
      ...(s as object),
      aspectRatio: 1,
    }));
    expect(validateLayout(legacy)).toBe(false);
  });
});
