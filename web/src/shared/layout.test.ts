import { describe, expect, it } from 'vitest';
import xboxDefault from '../layouts/xbox-default.json';
import { validateLayout } from './layout';

describe('validateLayout', () => {
  it('accepts the built-in document', () => {
    expect(validateLayout(xboxDefault)).toBe(true);
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
});
