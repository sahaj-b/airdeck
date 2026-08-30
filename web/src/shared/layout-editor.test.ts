import { describe, expect, it } from 'vitest';
import xboxDefault from '../layouts/xbox-default.json';
import type { Document as LayoutDocument } from './generated/layout';
import {
  clampDrag,
  clampGeometry,
  clampResize,
  clampSectionDivider,
  findControl,
  getBindingLabel,
  getHitfillsOf,
  isDefaultLocked,
  LayoutHistory,
  moveParentWithHitfills,
  pixelsToHeightUnits,
  updateControlGeometry,
} from './layout-editor';

const base = xboxDefault as unknown as LayoutDocument;

describe('layout-editor helpers', () => {
  it('groups hitfill with its parent as one history entry and moves both', () => {
    const history = new LayoutHistory(50);
    history.reset(base);
    const hitfills = getHitfillsOf(base, 'south');
    expect(hitfills).toContain('xyab-fill-s');
    expect(hitfills.length).toBe(1);

    const southBefore = base.sections[2].controls.find((c) => c.id === 'south');
    if (!southBefore) throw new Error('south missing');
    const fillerBefore = base.sections[2].controls.find(
      (c) => c.id === 'xyab-fill-s',
    );
    if (!fillerBefore) throw new Error('filler missing');
    const moved = moveParentWithHitfills(base, 'south', 0.02, 0.02);
    history.push(moved);
    expect(history.size).toBe(2);
    expect(history.canUndo).toBe(true);

    const southAfter = moved.sections[2].controls.find((c) => c.id === 'south');
    if (!southAfter) throw new Error('south missing');
    const fillerAfter = moved.sections[2].controls.find(
      (c) => c.id === 'xyab-fill-s',
    );
    if (!fillerAfter) throw new Error('filler missing');
    expect(southAfter.geometry.position.x).not.toBe(
      southBefore.geometry.position.x,
    );
    expect(fillerAfter.geometry.position.x).not.toBe(
      fillerBefore.geometry.position.x,
    );
    // both moved by same delta (clamped individually but within bounds)
    expect(
      fillerAfter.geometry.position.x - fillerBefore.geometry.position.x,
    ).toBeCloseTo(0.02, 5);

    const undone = history.undo();
    expect(undone?.id).toBe(base.id);
    expect(history.canRedo).toBe(true);
    const redone = history.redo();
    expect(
      redone?.sections[2].controls.find((c) => c.id === 'south')?.geometry
        .position.x,
    ).toBe(southAfter.geometry.position.x);
  });

  it('dragging hitfill moves only itself, not parent', () => {
    const hitfillId = 'xyab-fill-s';
    const foundHitfill = findControl(base, hitfillId);
    if (!foundHitfill) throw new Error('hitfill missing');
    const movedHitfill = updateControlGeometry(
      base,
      hitfillId,
      clampDrag(
        foundHitfill.control.geometry,
        0.03,
        0.03,
        foundHitfill.section,
      ),
    );
    const southBefore = base.sections[2].controls.find((c) => c.id === 'south');
    if (!southBefore) throw new Error('south missing');
    const southAfter = movedHitfill.sections[2].controls.find(
      (c) => c.id === 'south',
    );
    if (!southAfter) throw new Error('south missing');
    expect(southAfter.geometry.position.x).toBe(
      southBefore.geometry.position.x,
    );
    expect(southAfter.geometry.position.y).toBe(
      southBefore.geometry.position.y,
    );
  });

  it('caps history at 50 entries and treats parent+hitfills move as one', () => {
    const history = new LayoutHistory(5);
    history.reset(base);
    for (let index = 0; index < 10; index += 1) {
      const next = moveParentWithHitfills(
        history.current() as LayoutDocument,
        'south',
        0.01,
        0,
      );
      history.push(next);
    }
    expect(history.size).toBe(5);
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
    // midpoint clamping allows width up to 2, edges may overflow section
    expect(huge.size.width).toBeLessThanOrEqual(2);
    expect(huge.size.width).toBeGreaterThan(section.relativeWidth * 0.5);
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
    expect(getBindingLabel('south' as never)).toBe('South (A | Cross)');
    expect(getBindingLabel('leftShoulder' as never)).toBe(
      'LeftShoulder (LB | L1)',
    );
    expect(getBindingLabel('leftTrigger' as never)).toBe(
      'LeftTrigger (LT | L2)',
    );
    expect(pixelsToHeightUnits(100, 500)).toBe(0.2);
    expect(pixelsToHeightUnits(10, 0)).toBe(0);
  });
});
