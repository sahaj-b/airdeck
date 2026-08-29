import { describe, expect, it } from 'vitest';
import xboxDefault from '../layouts/xbox-default.json';
import type { LayoutDocument } from '../shared/layout';
import { allocateSections, resolveLayout } from './layout-resolver';

const layout = xboxDefault as LayoutDocument;

describe('responsive layout resolver', () => {
  it('keeps the side sections protected and shrinks the center first', () => {
    const allocation = allocateSections(layout, { width: 710, height: 400 });
    expect(allocation.widths[0]).toBeGreaterThanOrEqual(
      layout.sections[0].minWidth - 1e-6,
    );
    expect(allocation.widths[2]).toBeGreaterThanOrEqual(
      layout.sections[2].minWidth - 1e-6,
    );
    expect(allocation.widths[1]).toBeCloseTo(layout.sections[1].minWidth, 6);
    expect(allocation.widths[1]).toBeLessThan(layout.sections[1].aspectRatio);
  });

  it('gives wide-screen space to the flexible center with no gaps or margins', () => {
    const allocation = allocateSections(layout, { width: 1600, height: 400 });
    expect(allocation.widths[0]).toBeCloseTo(layout.sections[0].aspectRatio);
    expect(allocation.widths[2]).toBeCloseTo(layout.sections[2].aspectRatio);
    // center expands to fill viewport edge-to-edge
    const expectedCenter =
      1600 / 400 -
      layout.sections[0].aspectRatio -
      layout.sections[2].aspectRatio;
    expect(allocation.widths[1]).toBeCloseTo(expectedCenter, 6);
  });

  it('resolves centered positions and reference-dimension sizes', () => {
    const simple: LayoutDocument = {
      id: 'simple',
      name: 'Simple',
      schemaVersion: 1,
      defaultOrientation: 'landscape',
      sections: [
        {
          id: 'section',
          aspectRatio: 1,
          minWidth: 1,
          maxWidth: 1,
          flexGrow: 0,
          flexShrink: 0,
          protected: true,
          padding: { left: 0, right: 0, top: 0, bottom: 0 },
          controls: [
            {
              id: 'button',
              type: 'button',
              geometry: {
                position: { x: 0, y: 0 },
                size: { width: 0.2, height: 0.4 },
              },
              label: 'Button',
              visible: true,
              binding: 'south',
            },
          ],
        },
      ],
      assets: [],
    };
    const resolved = resolveLayout(simple, { width: 500, height: 500 });
    const control = resolved.sections[0].controls[0];
    expect(control.visual).toEqual({
      left: 200,
      top: 150,
      width: 100,
      height: 200,
    });
  });

  it('keeps hit bounds equal to visual bounds (WYSIWYG, use hitOnly fillers to expand)', () => {
    const simple: LayoutDocument = {
      id: 'touch',
      name: 'Touch',
      schemaVersion: 1,
      defaultOrientation: 'landscape',
      sections: [
        {
          id: 'section',
          aspectRatio: 1,
          minWidth: 1,
          maxWidth: 1,
          flexGrow: 0,
          flexShrink: 0,
          protected: true,
          padding: { left: 0, right: 0, top: 0, bottom: 0 },
          controls: [-0.25, 0.25].map((x, index) => ({
            id: `button-${index}`,
            type: 'button' as const,
            geometry: {
              position: { x, y: 0 },
              size: { width: 0.1, height: 0.1 },
            },
            label: 'Button',
            visible: true,
            binding: 'south' as const,
          })),
        },
      ],
      assets: [],
    };
    const controls = resolveLayout(simple, { width: 100, height: 100 })
      .sections[0].controls;
    expect(controls[0].visual.width).toBe(10);
    expect(controls[0].hit).toEqual(controls[0].visual);
    expect(controls[1].hit).toEqual(controls[1].visual);
  });

  it('reports the existing portrait fallback when no portrait geometry exists', () => {
    expect(
      resolveLayout(layout, { width: 400, height: 700 }, 'portrait')
        .portraitFallback,
    ).toBe(true);
  });
});
