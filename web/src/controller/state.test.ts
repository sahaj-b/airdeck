import { describe, expect, it } from 'vitest';
import { ButtonBits } from '../shared/contracts';
import { InputStateStore } from './state';

describe('InputStateStore', () => {
  it('keeps a duplicate button binding pressed until every owner releases it', () => {
    const state = new InputStateStore();
    state.setButton('first', 'south', true);
    state.setButton('second', 'south', true);
    state.setButton('first', 'south', false);
    expect(state.state.buttons & ButtonBits.south).toBe(ButtonBits.south);

    state.setButton('second', 'south', false);
    expect(state.state.buttons).toBe(0);
  });

  it('stores sticks and triggers in the wire ranges', () => {
    const state = new InputStateStore();
    state.setStick('stick', 'leftStick', -1, 0.5);
    state.setTrigger('trigger', 'rightTrigger', 0.5);
    expect(state.state.lx).toBe(-32768);
    expect(state.state.ly).toBe(16384);
    expect(state.state.rt).toBe(128);
  });

  it('clears every source kind and returns to a complete neutral state', () => {
    const state = new InputStateStore();
    state.setButton('source', 'start', true);
    state.setStick('source', 'rightStick', 1, -1);
    state.setTrigger('source', 'leftTrigger', 1);
    state.clearSource('source');
    expect(state.state).toEqual({
      buttons: 0,
      lx: 0,
      ly: 0,
      rx: 0,
      ry: 0,
      lt: 0,
      rt: 0,
    });
  });
});
