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
    portraitFallback:
      orientation === 'portrait' && document.defaultOrientation === 'landscape',
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
  const centerMin = document.sections[1].relativeMinWidth ?? 0;

  const idealCenter = available - leftW - rightW;
  if (idealCenter >= centerMin - EPSILON) {
    return { widths: [leftW, idealCenter, rightW] };
  }

  const sideAvailable = Math.max(0, available - centerMin);
  if (sideAvailable === 0) {
    return { widths: [0, Math.max(0, available), 0] };
  }

  const totalSide = leftW + rightW;
  const factor = sideAvailable / totalSide;
  return {
    widths: [leftW * factor, centerMin, rightW * factor],
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
