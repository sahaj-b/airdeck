import type { Document as LayoutDocument } from './generated/layout';
import { LAYOUT_SECTION_IDS } from './layout';

export interface Viewport {
  width: number;
  height: number;
}

export interface SectionAllocation {
  widths: number[];
}

const EPSILON = 1e-7;

export function allocateSections(
  document: LayoutDocument,
  viewport: Viewport,
): SectionAllocation {
  const reference = Math.max(0, viewport.height);
  const available = reference > 0 ? Math.max(0, viewport.width / reference) : 0;
  if (document.sections.length !== LAYOUT_SECTION_IDS.length) {
    return { widths: document.sections.map(() => 0) };
  }

  const leftW = document.sections[0].relativeWidth;
  const rightW = document.sections[2].relativeWidth;
  const centerMin = document.sections[1].relativeMinWidth ?? 0;

  const idealCenter = available - leftW - rightW;
  if (idealCenter >= centerMin - EPSILON) {
    return { widths: [leftW, idealCenter, rightW] };
  }

  const sideAvailable = available - centerMin;
  const totalSide = leftW + rightW;

  if (sideAvailable >= -EPSILON) {
    if (totalSide <= EPSILON) {
      return { widths: [0, centerMin, 0] };
    }
    const scale = sideAvailable / totalSide;
    return { widths: [leftW * scale, centerMin, rightW * scale] };
  }

  if (centerMin <= EPSILON) {
    if (available <= EPSILON) return { widths: [0, 0, 0] };
    const totalAuthored = leftW + rightW + Math.max(centerMin, idealCenter);
    const scale = totalAuthored > 0 ? available / totalAuthored : 0;
    return {
      widths: [
        leftW * scale,
        Math.max(0, available - leftW * scale - rightW * scale),
        rightW * scale,
      ],
    };
  }

  const scale = available / centerMin;
  return { widths: [0, centerMin * scale, 0] };
}
