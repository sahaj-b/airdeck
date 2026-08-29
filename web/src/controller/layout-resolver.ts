import type { Orientation } from '../shared/contracts';
import {
  type Control,
  type LayoutDocument,
  orientationGeometry,
  type Section,
} from '../shared/layout';

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
    const content: PixelRect = {
      left: left + section.padding.left * reference,
      top: section.padding.top * reference,
      width: Math.max(
        0,
        width - (section.padding.left + section.padding.right) * reference,
      ),
      height: Math.max(
        0,
        safeViewport.height -
          (section.padding.top + section.padding.bottom) * reference,
      ),
    };
    const controls: ResolvedControl[] = [];
    for (const control of section.controls) {
      if (!control.visible && !control.hitOnly) continue;
      controls.push(
        resolveControl(control, section, content, reference, orientation),
      );
    }
    sections.push({ section, rect, content, reference, controls });
    left += width;
  }

  return {
    orientation,
    viewport: safeViewport,
    sections,
    portraitFallback:
      orientation === 'portrait' &&
      document.defaultOrientation === 'landscape' &&
      !document.sections.some((section) =>
        section.controls.some((control) => control.orientations?.portrait),
      ),
  };
}

export function allocateSections(
  document: LayoutDocument,
  viewport: Viewport,
): SectionAllocation {
  const reference = Math.max(0, viewport.height);
  const widthRatio =
    reference > 0 ? Math.max(0, viewport.width / reference) : 0;
  const sectionCount = document.sections.length;
  if (sectionCount === 0) return { widths: [] };

  const available = widthRatio;
  const widths = document.sections.map((section) =>
    clamp(section.aspectRatio, section.minWidth, section.maxWidth),
  );

  const total = sum(widths);
  if (total > available) {
    let deficit = total - available;
    deficit = shrinkToFloor(
      widths,
      document.sections,
      deficit,
      (section) => !section.protected && section.flexShrink > 0,
      (section) => section.minWidth,
    );
    deficit = shrinkToFloor(
      widths,
      document.sections,
      deficit,
      (section) => section.flexShrink > 0,
      (section) => section.minWidth,
    );
    deficit = shrinkToFloor(
      widths,
      document.sections,
      deficit,
      (section) => section.flexShrink > 0,
      () => 0,
    );
    if (deficit > EPSILON) {
      const currentTotal = sum(widths);
      const scale = Math.max(
        0,
        (currentTotal - deficit) / Math.max(currentTotal, EPSILON),
      );
      for (let index = 0; index < widths.length; index += 1)
        widths[index] *= scale;
    }
  } else if (total < available) {
    distributeGrow(
      widths,
      document.sections,
      available - total,
      (section) => section.flexGrow > 0,
      (section) => section.maxWidth,
    );
  }

  return { widths };
}

function resolveControl(
  control: Control,
  section: Section,
  content: PixelRect,
  reference: number,
  orientation: Orientation,
): ResolvedControl {
  const geometry = orientationGeometry(control, orientation);
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
  return { control, sectionId: section.id, visual, hit: visual };
}

function shrinkToFloor(
  widths: number[],
  sections: Section[],
  deficit: number,
  predicate: (section: Section) => boolean,
  floor: (section: Section) => number,
): number {
  const candidates: { section: Section; index: number }[] = [];
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (predicate(section) && widths[index] > floor(section) + EPSILON) {
      candidates.push({ section, index });
    }
  }
  while (deficit > EPSILON && candidates.length > 0) {
    const weight = candidates.reduce(
      (total, { section, index }) =>
        total + Math.max(EPSILON, section.flexShrink) * widths[index],
      0,
    );
    if (weight <= EPSILON) break;
    let removed = 0;
    for (const { section, index } of candidates) {
      const capacity = Math.max(0, widths[index] - floor(section));
      const amount = Math.min(
        capacity,
        deficit *
          ((Math.max(EPSILON, section.flexShrink) * widths[index]) / weight),
      );
      widths[index] -= amount;
      removed += amount;
    }
    if (removed <= EPSILON) break;
    deficit -= removed;
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      if (widths[candidate.index] <= floor(candidate.section) + EPSILON)
        candidates.splice(index, 1);
    }
  }
  return Math.max(0, deficit);
}

function distributeGrow(
  widths: number[],
  sections: Section[],
  extra: number,
  predicate: (section: Section) => boolean,
  ceiling: (section: Section) => number,
): void {
  const candidates: { section: Section; index: number }[] = [];
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (predicate(section) && widths[index] < ceiling(section) - EPSILON) {
      candidates.push({ section, index });
    }
  }
  while (extra > EPSILON && candidates.length > 0) {
    const weight = candidates.reduce(
      (total, { section }) => total + Math.max(EPSILON, section.flexGrow),
      0,
    );
    let added = 0;
    for (const { section, index } of candidates) {
      const capacity = Math.max(0, ceiling(section) - widths[index]);
      const amount = Math.min(
        capacity,
        extra * (Math.max(EPSILON, section.flexGrow) / weight),
      );
      widths[index] += amount;
      added += amount;
    }
    if (added <= EPSILON) break;
    extra -= added;
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      if (widths[candidate.index] >= ceiling(candidate.section) - EPSILON)
        candidates.splice(index, 1);
    }
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
