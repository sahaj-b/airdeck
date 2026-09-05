import type { Orientation } from '../shared/contracts';
import type { Control, LayoutDocument, Section } from '../shared/layout';

export interface Viewport {
  width: number;
  height: number;
}

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ResolvedControl {
  control: Control;
  sectionId: string;
  visual: PixelRect;
  hit: PixelRect;
}

export interface ResolvedSection {
  section: Section;
  rect: PixelRect;
  content: PixelRect;
  reference: number;
  controls: ResolvedControl[];
}

export interface ResolvedLayout {
  orientation: Orientation;
  viewport: Viewport;
  sections: ResolvedSection[];
  portraitFallback: boolean;
}

export interface SectionAllocation {
  widths: number[];
}

export function findControlVisual(
  resolved: ResolvedLayout | null,
  controlId: string | null,
): PixelRect | null {
  if (!resolved || !controlId) return null;
  for (const section of resolved.sections) {
    for (const control of section.controls) {
      if (control.control.id === controlId) return control.visual;
    }
  }
  return null;
}

const EPSILON = 1e-7;

export function resolveLayout(
  document: LayoutDocument,
  viewport: Viewport,
  orientation: Orientation = 'landscape',
): ResolvedLayout {
  const safeViewport = {
    width: Math.max(0, viewport.width),
    height: Math.max(0, viewport.height),
  };
  const allocation = allocateSections(document, safeViewport);
  const reference = safeViewport.height;
  const sections: ResolvedSection[] = [];
  let left = 0;

  for (let index = 0; index < document.sections.length; index += 1) {
    const section = document.sections[index];
    const width = allocation.widths[index] * reference;
    const rect: PixelRect = {
      left,
      top: 0,
      width,
      height: safeViewport.height,
    };
    const content: PixelRect = { ...rect };

    const controls: ResolvedControl[] = [];
    for (const control of section.controls) {
      controls.push(resolveControl(control, section.id, content, reference));
    }
    sections.push({ section, rect, content, reference, controls });
    left += width;
  }

  return {
    orientation,
    viewport: safeViewport,
    sections,
    portraitFallback: orientation === 'portrait',
  };
}

export function allocateSections(
  document: LayoutDocument,
  viewport: Viewport,
): SectionAllocation {
  const reference = Math.max(0, viewport.height);
  const available = reference > 0 ? Math.max(0, viewport.width / reference) : 0;
  if (document.sections.length !== 3) {
    return { widths: document.sections.map(() => 0) };
  }

  const leftW = document.sections[0].relativeWidth;
  const rightW = document.sections[2].relativeWidth;
  const leftMin = 0;
  const rightMin = 0;
  const centerMin = document.sections[1].relativeMinWidth ?? 0;

  const idealCenter = available - leftW - rightW;
  if (idealCenter >= centerMin - EPSILON) {
    // Phase 1: center has room, sides stay at authored
    return { widths: [leftW, idealCenter, rightW] };
  }

  // Phase 2: center at min, sides shrink proportionally toward 0
  const sideAvailable = available - centerMin;
  const totalSide = leftW + rightW;

  if (sideAvailable >= -EPSILON) {
    if (totalSide <= EPSILON) {
      return { widths: [0, centerMin, 0] };
    }
    const t = sideAvailable / totalSide;
    const leftScaled = leftW * t;
    const rightScaled = rightW * t;
    return { widths: [leftScaled, centerMin, rightScaled] };
  }

  // Phase 3: available < centerMin, center and sides below zero impossible, center shrinks
  const totalMin = centerMin;
  if (totalMin <= EPSILON) {
    if (available <= EPSILON) return { widths: [0, 0, 0] };
    const totalAuthored = leftW + rightW + Math.max(centerMin, idealCenter);
    const factor = totalAuthored > 0 ? available / totalAuthored : 0;
    return {
      widths: [
        leftW * factor,
        Math.max(0, available - leftW * factor - rightW * factor),
        rightW * factor,
      ],
    };
  }
  const factor = available / totalMin;
  return {
    widths: [leftMin * factor, centerMin * factor, rightMin * factor],
  };
}

function resolveControl(
  control: Control,
  sectionId: string,
  content: PixelRect,
  reference: number,
): ResolvedControl {
  const geometry = control.geometry;
  const width = geometry.size.width * reference;
  const height = geometry.size.height * reference;
  const centerX = content.left + content.width / 2;
  const centerY = content.top + content.height / 2;
  const visual: PixelRect = {
    left: centerX + geometry.position.x * reference - width / 2,
    top: centerY + geometry.position.y * reference - height / 2,
    width,
    height,
  };
  return { control, sectionId, visual, hit: visual };
}
