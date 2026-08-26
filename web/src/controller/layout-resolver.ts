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
  gap: number;
  outerGutter: number;
}

const EPSILON = 1e-7;

export function resolveLayout(
  document: LayoutDocument,
  viewport: Viewport,
  orientation: Orientation = 'landscape',
  minimumHitSize = 44,
): ResolvedLayout {
  const safeViewport = {
    width: Math.max(0, viewport.width),
    height: Math.max(0, viewport.height),
  };
  const allocation = allocateSections(document, safeViewport);
  const reference = safeViewport.height;
  const sections: ResolvedSection[] = [];
  let left = allocation.outerGutter * reference;

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
    const controls = section.controls
      .filter((control) => control.visible)
      .map((control) =>
        resolveControl(
          control,
          section,
          content,
          reference,
          orientation,
          minimumHitSize,
        ),
      );
    sections.push({ section, rect, content, reference, controls });
    left += width + allocation.gap * reference;
  }

  limitHitTargets(sections);

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
  if (sectionCount === 0)
    return { widths: [], gap: 0, outerGutter: widthRatio / 2 };

  const gap = Math.min(
    Math.max(0, document.gap),
    sectionCount > 1 ? widthRatio / (sectionCount - 1) : 0,
  );
  const available = Math.max(0, widthRatio - gap * (sectionCount - 1));
  const widths = document.sections.map((section) =>
    clamp(section.aspectRatio, section.minWidth, section.maxWidth),
  );

  let total = sum(widths);
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

  total = sum(widths);
  let remaining = Math.max(0, widthRatio - total - gap * (sectionCount - 1));
  let resolvedGap = gap;
  if (sectionCount > 1 && remaining > EPSILON) {
    const gapCapacity = Math.max(0, document.gapMax - resolvedGap);
    const gapGrowth = Math.min(gapCapacity, remaining / (sectionCount - 1));
    resolvedGap += gapGrowth;
    remaining -= gapGrowth * (sectionCount - 1);
  }

  return {
    widths,
    gap: resolvedGap,
    outerGutter: Math.max(0, remaining / 2),
  };
}

function resolveControl(
  control: Control,
  section: Section,
  content: PixelRect,
  reference: number,
  orientation: Orientation,
  minimumHitSize: number,
): ResolvedControl {
  const geometry = orientationGeometry(control, orientation);
  const width = geometry.size.width * reference;
  const height = geometry.size.height * reference;
  const centerX = content.left + content.width / 2;
  const centerY = content.top + content.height / 2;
  const visual: PixelRect = {
    left: centerX + geometry.position.x * reference - geometry.anchor.x * width,
    top: centerY + geometry.position.y * reference - geometry.anchor.y * height,
    width,
    height,
  };
  return {
    control,
    sectionId: section.id,
    visual,
    hit: isInteractive(control)
      ? expandedHitRect(visual, minimumHitSize, content, reference)
      : visual,
  };
}

function isInteractive(control: Control): boolean {
  return (
    control.type === 'button' ||
    control.type === 'dpad' ||
    control.type === 'joystick' ||
    control.type === 'trigger'
  );
}

function expandedHitRect(
  visual: PixelRect,
  minimumHitSize: number,
  section: PixelRect,
  reference: number,
): PixelRect {
  const target = Math.max(0, minimumHitSize);
  const expansionLimit = Math.max(8, Math.min(reference * 0.2, target));
  const extraWidth = Math.min(
    expansionLimit,
    Math.max(0, (target - visual.width) / 2),
  );
  const extraHeight = Math.min(
    expansionLimit,
    Math.max(0, (target - visual.height) / 2),
  );
  const left = Math.max(section.left, visual.left - extraWidth / 2);
  const top = Math.max(section.top, visual.top - extraHeight / 2);
  const right = Math.min(
    section.left + section.width,
    visual.left + visual.width + extraWidth / 2,
  );
  const bottom = Math.min(
    section.top + section.height,
    visual.top + visual.height + extraHeight / 2,
  );
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function limitHitTargets(sections: ResolvedSection[]): void {
  for (const section of sections) {
    const interactive = section.controls.filter((control) =>
      isInteractive(control.control),
    );
    for (const current of interactive) {
      for (const neighbor of interactive) {
        if (current === neighbor) continue;
        limitAgainstNeighbor(current.hit, current.visual, neighbor.visual);
      }
    }
  }
}

function limitAgainstNeighbor(
  hit: PixelRect,
  visual: PixelRect,
  neighbor: PixelRect,
): void {
  const verticalOverlap = overlaps(
    visual.top,
    visual.top + visual.height,
    neighbor.top,
    neighbor.top + neighbor.height,
  );
  const horizontalOverlap = overlaps(
    visual.left,
    visual.left + visual.width,
    neighbor.left,
    neighbor.left + neighbor.width,
  );
  if (verticalOverlap) {
    if (neighbor.left + neighbor.width <= visual.left)
      clampLeft(hit, (neighbor.left + neighbor.width + visual.left) / 2);
    if (neighbor.left >= visual.left + visual.width)
      clampRight(hit, (neighbor.left + visual.left + visual.width) / 2);
  }
  if (horizontalOverlap) {
    if (neighbor.top + neighbor.height <= visual.top)
      clampTop(hit, (neighbor.top + neighbor.height + visual.top) / 2);
    if (neighbor.top >= visual.top + visual.height)
      clampBottom(hit, (neighbor.top + visual.top + visual.height) / 2);
  }
}

function clampLeft(hit: PixelRect, limit: number): void {
  const right = hit.left + hit.width;
  hit.left = Math.max(hit.left, limit);
  hit.width = Math.max(0, right - hit.left);
}

function clampRight(hit: PixelRect, limit: number): void {
  hit.width = Math.max(0, Math.min(hit.width, limit - hit.left));
}

function clampTop(hit: PixelRect, limit: number): void {
  const bottom = hit.top + hit.height;
  hit.top = Math.max(hit.top, limit);
  hit.height = Math.max(0, bottom - hit.top);
}

function clampBottom(hit: PixelRect, limit: number): void {
  hit.height = Math.max(0, Math.min(hit.height, limit - hit.top));
}

function overlaps(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): boolean {
  return firstStart < secondEnd && secondStart < firstEnd;
}

function shrinkToFloor(
  widths: number[],
  sections: Section[],
  deficit: number,
  predicate: (section: Section) => boolean,
  floor: (section: Section) => number,
): number {
  const candidates = sections
    .map((section, index) => ({ section, index }))
    .filter(
      ({ section, index }) =>
        predicate(section) && widths[index] > floor(section) + EPSILON,
    );
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
  const candidates = sections
    .map((section, index) => ({ section, index }))
    .filter(
      ({ section, index }) =>
        predicate(section) && widths[index] < ceiling(section) - EPSILON,
    );
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
