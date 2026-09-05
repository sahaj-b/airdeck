import type { Orientation } from '../shared/contracts';
import type { Control, LayoutDocument, Section } from '../shared/layout';
import { allocateSections, type Viewport } from '../shared/layout-geometry';

export type { Viewport } from '../shared/layout-geometry';

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
