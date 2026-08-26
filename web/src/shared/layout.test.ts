import { describe, expect, it } from 'vitest';
import xboxDefault from '../layouts/xbox-default.json';
import { DEFAULT_LAYOUT, parseLayoutDocument, validateLayout } from './layout';

describe('validateLayout', () => {
  it('accepts the built-in document', () => {
    expect(validateLayout(xboxDefault)).toBe(true);
  });

  it('falls back to the built-in document when a received document is invalid', () => {
    const result = parseLayoutDocument({ schemaVersion: 2 });
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
    if (!dpad?.bindings) throw new Error('built-in d-pad missing');
    delete (dpad.bindings as Partial<typeof dpad.bindings>).right;
    expect(validateLayout(incomplete)).toBe(false);
  });

  it('rejects non-square joysticks and unknown shapes', () => {
    const oval = structuredClone(xboxDefault) as typeof xboxDefault;
    const stick = oval.sections[0].controls.find(
      (control) => control.type === 'joystick',
    );
    if (!stick) throw new Error('built-in joystick missing');
    stick.geometry.size.height = stick.geometry.size.width / 2;
    expect(validateLayout(oval)).toBe(false);

    const shaped = structuredClone(xboxDefault) as typeof xboxDefault;
    shaped.sections[0].controls[0].shape = 'triangle';
    expect(validateLayout(shaped)).toBe(false);
  });

  it('rejects invalid section constraints and geometry outside a section', () => {
    const invalidSection = structuredClone(xboxDefault) as typeof xboxDefault;
    invalidSection.sections[1].maxWidth =
      invalidSection.sections[1].minWidth / 2;
    expect(validateLayout(invalidSection)).toBe(false);

    const invalidGeometry = structuredClone(xboxDefault) as typeof xboxDefault;
    invalidGeometry.sections[0].controls[0].geometry.position.x = 2;
    expect(validateLayout(invalidGeometry)).toBe(false);
  });
});
