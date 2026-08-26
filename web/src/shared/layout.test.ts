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
    stick.rect.height = stick.rect.width / 2;
    expect(validateLayout(oval)).toBe(false);

    const shaped = structuredClone(xboxDefault) as typeof xboxDefault;
    shaped.sections[0].controls[0].shape = 'triangle';
    expect(validateLayout(shaped)).toBe(false);
  });

  it('allows wide controls whose width fraction exceeds the remaining x space', () => {
    const wide = structuredClone(xboxDefault) as typeof xboxDefault;
    const trigger = wide.sections[0].controls.find(
      (control) => control.type === 'trigger',
    );
    if (!trigger) throw new Error('built-in trigger missing');
    trigger.rect.x = 0.9;
    expect(validateLayout(wide)).toBe(true);
  });
});
