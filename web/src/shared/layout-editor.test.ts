import { describe, expect, it } from 'vitest';
import xboxDefault from '../layouts/xbox-default.json';
import type { Document as LayoutDocument } from './generated/layout';
import {
  clampDrag,
  clampGeometry,
  clampResize,
  clampSectionDivider,
  getBindingLabel,
  getLinkedGroup,
  isDefaultLocked,
  LayoutHistory,
  moveLinkedGroup,
  pixelsToHeightUnits,
} from './layout-editor';

const base = xboxDefault as unknown as LayoutDocument;

describe('layout-editor helpers', () => {
  it('groups XYAB face button with its hitOnly fillers as one history entry', () => {
    const history = new LayoutHistory(50);
    history.reset(base);
    const south = base.sections[2].controls.find(
      (candidate: { id: string }) => candidate.id === 'south',
    );
    if (!south) throw new Error('south missing');
    const group = getLinkedGroup(base, 'south');
    expect(group).toContain('south');
    // xbox default has fillers per face binding but only one per binding
    expect(group.length).toBeGreaterThan(1);

    const moved = moveLinkedGroup(base, 'south', 0.02, 0.02);
    history.push(moved);
    expect(history.size).toBe(2);
    expect(history.canUndo).toBe(true);
    const undone = history.undo();
    expect(undone?.id).toBe(base.id);
    expect(history.canRedo).toBe(true);
    const redone = history.redo();
    expect(
      redone?.sections[2].controls.find(
        (candidate: { id: string }) => candidate.id === 'south',
      )?.geometry.position.x,
    ).toBe(
      moved.sections[2].controls.find(
        (candidate: { id: string }) => candidate.id === 'south',
      )?.geometry.position.x,
    );
  });

  it('caps history at 50 entries and treats group move as one', () => {
    const history = new LayoutHistory(5);
    history.reset(base);
    for (let index = 0; index < 10; index += 1) {
      const next = moveLinkedGroup(
        history.current() as LayoutDocument,
        'south',
        0.01,
        0,
      );
      history.push(next);
    }
    expect(history.size).toBe(5);
    // walk back to oldest retained
    let steps = 0;
    while (history.canUndo) {
      history.undo();
      steps += 1;
    }
    expect(steps).toBe(4);
  });

  it('clamps drag inside authored section bounds and preserves locked square', () => {
    const section = base.sections[0];
    const control = section.controls.find(
      (candidate: { type: string }) => candidate.type === 'joystick',
    );
    if (!control) throw new Error('joystick missing');
    expect(isDefaultLocked(control)).toBe(true);

    const clamped = clampDrag(control.geometry, 5, 5, section);
    // Should stay inside bounds
    expect(clamped.position.x).toBeLessThan(2);
    expect(clamped.position.y).toBeLessThan(2);

    const resizedLocked = clampResize(
      control.geometry,
      0.2,
      0.1,
      section,
      true,
    );
    expect(
      Math.abs(resizedLocked.size.width - resizedLocked.size.height),
    ).toBeLessThan(0.01);

    const resizedUnlocked = clampResize(
      control.geometry,
      0.2,
      0.1,
      section,
      false,
    );
    expect(
      Math.abs(resizedUnlocked.size.width - resizedUnlocked.size.height),
    ).toBeGreaterThan(0.01);

    const huge = clampGeometry(
      { position: { x: 10, y: 10 }, size: { width: 5, height: 5 } },
      section,
    );
    expect(huge.position.x).toBeLessThan(2);
    expect(huge.size.width).toBeLessThanOrEqual(section.relativeWidth);
  });

  it('clamps section dividers to keep center minimum and viewport bounds', () => {
    const viewport = { width: 667, height: 375 };
    const leftClamped = clampSectionDivider(base, 'left', 5, viewport);
    expect(leftClamped).toBeLessThan(viewport.width / viewport.height);
    const rightClamped = clampSectionDivider(base, 'right', -1, viewport);
    expect(rightClamped).toBeGreaterThan(0);

    const narrow = { width: 300, height: 500 };
    const narrowLeft = clampSectionDivider(base, 'left', 1, narrow);
    expect(narrowLeft).toBeGreaterThan(0);
    expect(narrowLeft).toBeLessThan(narrow.width / narrow.height);
  });

  it('exposes dual Xbox/PlayStation binding labels and pixel conversion', () => {
    expect(getBindingLabel('south' as never)).toBe('south (A | Cross)');
    expect(getBindingLabel('leftShoulder' as never)).toBe(
      'leftShoulder (LB | L1)',
    );
    expect(getBindingLabel('leftTrigger' as never)).toBe(
      'leftTrigger (LT | L2)',
    );
    expect(pixelsToHeightUnits(100, 500)).toBe(0.2);
    expect(pixelsToHeightUnits(10, 0)).toBe(0);
  });
});
