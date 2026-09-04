import { describe, expect, it } from 'vitest';
import xboxDefault from '../layouts/xbox-default.json';
import {
  DEFAULT_LAYOUT,
  getControlErrors,
  parseLayoutDocument,
  validateLayout,
} from './layout';

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

  it('rejects oval sticks and accepts square sticks', () => {
    const oval = structuredClone(xboxDefault) as typeof xboxDefault;
    const stick = oval.sections[0].controls.find(
      (control) => control.type === 'joystick',
    );
    if (!stick) throw new Error('built-in joystick missing');
    stick.geometry.size.height = stick.geometry.size.width / 2;
    expect(validateLayout(oval)).toBe(false);

    const square = structuredClone(xboxDefault) as typeof xboxDefault;
    expect(validateLayout(square)).toBe(true);

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

describe('subLabel', () => {
  const section = {
    id: 'left',
    relativeWidth: 0.86,
    controls: [],
  } as unknown as import('./layout').Section;
  const button = {
    id: 'a',
    type: 'button',
    geometry: {
      position: { x: 0, y: 0 },
      size: { width: 0.2, height: 0.2 },
    },
    label: 'A',
    binding: 'south',
  } as unknown as import('./layout').Control;

  it('accepts short hints and counts emoji as single characters', () => {
    expect(getControlErrors({ ...button, subLabel: 'Dash' }, section)).toEqual(
      [],
    );
    expect(getControlErrors({ ...button }, section)).toEqual([]);
    expect(
      getControlErrors({ ...button, subLabel: '🔥'.repeat(20) }, section),
    ).toEqual([]);
  });

  it('rejects overlong hints and hints on label or hitzone controls', () => {
    const long = getControlErrors(
      { ...button, subLabel: '🔥'.repeat(21) },
      section,
    );
    expect(long.some((error) => error.path === 'subLabel')).toBe(true);
    const label = getControlErrors(
      { ...button, type: 'label', subLabel: 'Dash' },
      section,
    );
    expect(label.some((error) => error.path === 'subLabel')).toBe(true);
    const hitzone = getControlErrors(
      { ...button, type: 'hitzone', parentId: 'a', subLabel: 'Dash' },
      section,
    );
    expect(hitzone.some((error) => error.path === 'subLabel')).toBe(true);
  });
});
