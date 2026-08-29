import { describe, expect, it } from 'vitest';
import xboxDefault from '../layouts/xbox-default.json';
import type { LayoutDocument } from '../shared/layout';
import { allocateSections, resolveLayout } from './layout-resolver';

const layout = xboxDefault as LayoutDocument;

describe('responsive layout resolver', () => {
  it('pins left/right at authored width and gives remaining to center', () => {
    // viewport 1600x400 => available 4, left 0.86 right 0.94 => center 2.2
    const allocation = allocateSections(layout, { width: 1600, height: 400 });
    expect(allocation.widths[0]).toBeCloseTo(0.86, 6);
    expect(allocation.widths[2]).toBeCloseTo(0.94, 6);
    const expectedCenter = 1600 / 400 - 0.86 - 0.94;
    expect(allocation.widths[1]).toBeCloseTo(expectedCenter, 6);
  });

  it('scales sides proportionally when center would drop below its minimum', () => {
    // width 710 height 400 => available 1.775, sides 1.8 overflow, centerMin 0.38
    // sideAvailable = 1.775 - 0.38 = 1.395, factor =1.395/1.8=0.775
    const allocation = allocateSections(layout, { width: 710, height: 400 });
    expect(allocation.widths[1]).toBeCloseTo(0.38, 6);
    const factor = (710 / 400 - 0.38) / (0.86 + 0.94);
    expect(allocation.widths[0]).toBeCloseTo(0.86 * factor, 6);
    expect(allocation.widths[2]).toBeCloseTo(0.94 * factor, 6);
    // total fits viewport
    expect(
      allocation.widths[0] + allocation.widths[1] + allocation.widths[2],
    ).toBeCloseTo(710 / 400, 6);
  });

  it('resolves centered positions and reference-dimension sizes', () => {
    const simple: LayoutDocument = {
      id: 'simple',
      name: 'Simple',
      schemaVersion: 1,
      defaultOrientation: 'landscape',
      sections: [
        {
          id: 'left',
          relativeWidth: 1,
          relativeMinWidth: 0.5,
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
        { id: 'center', relativeWidth: 0.5, controls: [] },
        { id: 'right', relativeWidth: 1, controls: [] },
      ],
      assets: [],
    };
    // viewport width = left + center + right = 2.5 * height, so center fills exactly 0.5
    const resolved = resolveLayout(simple, { width: 1250, height: 500 });
    const leftSection = resolved.sections[0];
    expect(leftSection.rect.width).toBeCloseTo(500, 6);
    expect(leftSection.rect.left).toBe(0);
    const control = leftSection.controls[0];
    // left section 1*500 =500 wide, center at 250, size 0.2*500=100 width, 0.4*500=200 height
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
          id: 'left',
          relativeWidth: 1,
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
        { id: 'center', relativeWidth: 0.5, controls: [] },
        { id: 'right', relativeWidth: 1, controls: [] },
      ],
      assets: [],
    };
    // need viewport at least 2.5*100=250 to fit sides+center
    const controls = resolveLayout(simple, { width: 300, height: 100 })
      .sections[0].controls;
    expect(controls[0].visual.width).toBe(10);
    expect(controls[0].hit).toEqual(controls[0].visual);
    expect(controls[1].hit).toEqual(controls[1].visual);
  });

  it('reports the existing portrait fallback when default is landscape', () => {
    expect(
      resolveLayout(layout, { width: 400, height: 700 }, 'portrait')
        .portraitFallback,
    ).toBe(true);
    expect(
      resolveLayout(layout, { width: 700, height: 400 }, 'landscape')
        .portraitFallback,
    ).toBe(false);
  });
});
