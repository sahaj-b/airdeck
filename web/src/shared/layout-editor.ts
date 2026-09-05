import type {
  Control,
  Geometry,
  Document as LayoutDocument,
  Section,
} from './generated/layout';
import type { Command } from './generated/protocol';

export const SECTION_IDS = ['left', 'center', 'right'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

interface BindingLabel {
  command: Command;
  xbox: string;
  playstation: string;
  dual: string;
}

const BINDING_LABELS: Record<string, BindingLabel> = {
  south: {
    command: 'south' as Command,
    xbox: 'A',
    playstation: 'Cross',
    dual: 'south (A | Cross)',
  },
  east: {
    command: 'east' as Command,
    xbox: 'B',
    playstation: 'Circle',
    dual: 'east (B | Circle)',
  },
  west: {
    command: 'west' as Command,
    xbox: 'X',
    playstation: 'Square',
    dual: 'west (X | Square)',
  },
  north: {
    command: 'north' as Command,
    xbox: 'Y',
    playstation: 'Triangle',
    dual: 'north (Y | Triangle)',
  },
  dpadUp: {
    command: 'dpadUp' as Command,
    xbox: 'D-pad Up',
    playstation: 'D-pad Up',
    dual: 'dpadUp (D-pad Up)',
  },
  dpadDown: {
    command: 'dpadDown' as Command,
    xbox: 'D-pad Down',
    playstation: 'D-pad Down',
    dual: 'dpadDown (D-pad Down)',
  },
  dpadLeft: {
    command: 'dpadLeft' as Command,
    xbox: 'D-pad Left',
    playstation: 'D-pad Left',
    dual: 'dpadLeft (D-pad Left)',
  },
  dpadRight: {
    command: 'dpadRight' as Command,
    xbox: 'D-pad Right',
    playstation: 'D-pad Right',
    dual: 'dpadRight (D-pad Right)',
  },
  leftShoulder: {
    command: 'leftShoulder' as Command,
    xbox: 'LB',
    playstation: 'L1',
    dual: 'leftShoulder (LB | L1)',
  },
  rightShoulder: {
    command: 'rightShoulder' as Command,
    xbox: 'RB',
    playstation: 'R1',
    dual: 'rightShoulder (RB | R1)',
  },
  leftStick: {
    command: 'leftStick' as Command,
    xbox: 'LS',
    playstation: 'L3',
    dual: 'leftStick (LS | L3)',
  },
  rightStick: {
    command: 'rightStick' as Command,
    xbox: 'RS',
    playstation: 'R3',
    dual: 'rightStick (RS | R3)',
  },
  start: {
    command: 'start' as Command,
    xbox: 'Start',
    playstation: 'Options',
    dual: 'start (Start | Options)',
  },
  back: {
    command: 'back' as Command,
    xbox: 'Back',
    playstation: 'Share',
    dual: 'back (Back | Share)',
  },
  guide: {
    command: 'guide' as Command,
    xbox: 'Guide',
    playstation: 'PS',
    dual: 'guide (Guide | PS)',
  },
  leftTrigger: {
    command: 'leftTrigger' as Command,
    xbox: 'LT',
    playstation: 'L2',
    dual: 'leftTrigger (LT | L2)',
  },
  rightTrigger: {
    command: 'rightTrigger' as Command,
    xbox: 'RT',
    playstation: 'R2',
    dual: 'rightTrigger (RT | R2)',
  },
};

export function getBindingLabel(
  command: Command,
  controlType?: Control['type'],
): string {
  if (command === 'leftStick' || command === 'rightStick') {
    const base = command === 'leftStick' ? 'LeftStick' : 'RightStick';
    const xbox = command === 'leftStick' ? 'LS' : 'RS';
    const ps = command === 'leftStick' ? 'L3' : 'R3';
    if (controlType === 'button') return `${base} Click (${xbox} | ${ps})`;
    if (controlType === 'joystick') return `${base} (${xbox})`;
  }
  const label = BINDING_LABELS[command]?.dual ?? command;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function getAllowedBindings(type: Control['type']): Command[] {
  switch (type) {
    case 'joystick':
      return ['leftStick', 'rightStick'] as Command[];
    case 'trigger':
      return ['leftTrigger', 'rightTrigger'] as Command[];
    case 'dpad':
      return ['dpadUp', 'dpadDown', 'dpadLeft', 'dpadRight'] as Command[];
    case 'label':
    case 'hitzone':
      return [];
    default:
      return Object.keys(BINDING_LABELS) as Command[];
  }
}

export function normalizeRotationDeg(value: number): number {
  if (!Number.isFinite(value)) return 0;
  let next = value % 360;
  if (next < 0) next += 360;
  if (Object.is(next, -0)) next = 0;
  return next;
}

export function rotationOf(control: Control): number {
  return typeof control.rotation === 'number'
    ? normalizeRotationDeg(control.rotation)
    : 0;
}

export function updateControlRotation(
  document: LayoutDocument,
  controlId: string,
  nextRotation: number,
): LayoutDocument {
  const next = cloneDocument(document);
  for (const section of next.sections) {
    const control = section.controls.find(
      (candidate) => candidate.id === controlId,
    );
    if (control) {
      const normalized = normalizeRotationDeg(nextRotation);
      if (normalized === 0) {
        delete control.rotation;
      } else {
        control.rotation = normalized;
      }
      break;
    }
  }
  return next;
}

export function effectiveHitShape(control: Control): 'rect' | 'ellipse' {
  if (control.type === 'dpad') return 'rect';
  if (control.type === 'hitzone')
    return control.shape === 'round' ? 'ellipse' : 'rect';
  if (control.type === 'label') return 'rect';
  if ((control as unknown as { hitShape?: string }).hitShape === 'rect')
    return 'rect';
  if (control.shape === 'round') return 'ellipse';
  return 'rect';
}

export function isDefaultLocked(control: Control): boolean {
  if (control.type === 'joystick' || control.type === 'dpad') return true;
  return false;
}

export function isAspectLockForced(control: Control): boolean {
  return control.type === 'joystick';
}

export function resolveAspectLock(
  control: Control,
  locks: Record<string, boolean>,
): boolean {
  if (isAspectLockForced(control)) return true;
  return locks[control.id] ?? isDefaultLocked(control);
}

export function soloStick(section: Section): Control | null {
  let solo: Control | null = null;
  let count = 0;
  for (const control of section.controls) {
    if (control.type !== 'joystick') continue;
    count += 1;
    solo = control;
  }
  if (count !== 1 || !solo) return null;
  return solo;
}

export function cloneDocument(document: LayoutDocument): LayoutDocument {
  return structuredClone(document);
}

export function getSection(
  document: LayoutDocument,
  id: SectionId,
): Section | undefined {
  return document.sections.find((section) => section.id === id) as
    | Section
    | undefined;
}

export function findControl(
  document: LayoutDocument,
  controlId: string,
): { control: Control; section: Section } | undefined {
  for (const section of document.sections) {
    const control = section.controls.find(
      (candidate) => candidate.id === controlId,
    );
    if (control) return { control, section };
  }
  return undefined;
}

export function clampGeometry(geometry: Geometry, section: Section): Geometry {
  const contentWidth = section.relativeWidth;
  const contentHeight = 1;
  const centerX = contentWidth / 2;
  const centerY = contentHeight / 2;
  let { x, y } = geometry.position;
  let { width, height } = geometry.size;

  // Midpoint clamping: center must stay inside section, edges may overflow.
  // This lets controls kiss the divider without being blocked by their own size.
  width = Math.min(Math.max(width, 0.01), 2);
  height = Math.min(Math.max(height, 0.01), 2);

  const minX = -centerX;
  const maxX = contentWidth - centerX;
  const minY = -centerY;
  const maxY = contentHeight - centerY;
  x = Math.min(Math.max(x, minX), maxX);
  y = Math.min(Math.max(y, minY), maxY);

  return { position: { x, y }, size: { width, height } };
}

export function clampDrag(
  geometry: Geometry,
  deltaX: number,
  deltaY: number,
  section: Section,
): Geometry {
  const next: Geometry = {
    position: {
      x: geometry.position.x + deltaX,
      y: geometry.position.y + deltaY,
    },
    size: { ...geometry.size },
  };
  return clampGeometry(next, section);
}

export function clampResize(
  geometry: Geometry,
  deltaWidth: number,
  deltaHeight: number,
  section: Section,
  locked: boolean,
  deltaLeft = 0,
  deltaTop = 0,
): Geometry {
  let width = geometry.size.width + deltaWidth;
  let height = geometry.size.height + deltaHeight;
  const rawDeltaWidth = deltaWidth;
  const rawDeltaHeight = deltaHeight;
  if (locked) {
    const ratio = geometry.size.width / geometry.size.height || 1;
    if (Math.abs(rawDeltaWidth) > Math.abs(rawDeltaHeight)) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
  }
  // clamp size before computing deltas so finalDelta is accurate
  width = Math.min(Math.max(width, 0.01), 2);
  height = Math.min(Math.max(height, 0.01), 2);

  const finalDeltaWidth = width - geometry.size.width;
  const finalDeltaHeight = height - geometry.size.height;

  let deltaX = 0;
  let deltaY = 0;
  const hasLeft = Math.abs(deltaLeft) > 1e-9;
  const hasTop = Math.abs(deltaTop) > 1e-9;
  const hasWidthDrag = Math.abs(rawDeltaWidth) > 1e-9;
  const hasHeightDrag = Math.abs(rawDeltaHeight) > 1e-9;

  if (locked) {
    if (hasWidthDrag && hasHeightDrag) {
      if (hasLeft) deltaX = -finalDeltaWidth / 2;
      else deltaX = finalDeltaWidth / 2;
      if (hasTop) deltaY = -finalDeltaHeight / 2;
      else deltaY = finalDeltaHeight / 2;
    } else if (hasWidthDrag) {
      if (hasLeft) deltaX = -finalDeltaWidth / 2;
      else deltaX = finalDeltaWidth / 2;
      deltaY = 0;
    } else if (hasHeightDrag) {
      if (hasTop) deltaY = -finalDeltaHeight / 2;
      else deltaY = finalDeltaHeight / 2;
      deltaX = 0;
    }
  } else {
    if (hasWidthDrag) {
      if (hasLeft) deltaX = -finalDeltaWidth / 2;
      else deltaX = finalDeltaWidth / 2;
    }
    if (hasHeightDrag) {
      if (hasTop) deltaY = -finalDeltaHeight / 2;
      else deltaY = finalDeltaHeight / 2;
    }
  }

  const next: Geometry = {
    position: {
      x: geometry.position.x + deltaX,
      y: geometry.position.y + deltaY,
    },
    size: { width, height },
  };
  return clampGeometry(next, section);
}

export function getSectionControlMin(section: Section): number {
  const BASE_MIN = 0.1;
  if (section.controls.length === 0) return BASE_MIN;
  const maxAbsX = Math.max(
    ...section.controls.map((c) => Math.abs(c.geometry.position.x)),
  );
  const controlMin = maxAbsX * 2;
  const epsilon = 1e-6;
  return Math.max(BASE_MIN, controlMin + epsilon);
}

export function getSectionConfiguredMin(section: Section): number {
  if (section.id !== 'center') return 0;
  return section.relativeMinWidth ?? 0;
}

export function getSectionMinWidth(section: Section): number {
  if (section.id !== 'center') return getSectionControlMin(section);
  return Math.max(
    getSectionControlMin(section),
    getSectionConfiguredMin(section),
  );
}

export function getBlockingControls(
  section: Section,
  width: number,
): Control[] {
  const eps = 1e-9;
  const half = width / 2;
  return section.controls.filter(
    (c) => Math.abs(c.geometry.position.x) > half + eps,
  );
}

// Clamp proposed side width so the side stays wide enough for its controls.
// Hard wall is controlMin, no configured min for sides. Sides shrink
// indefinitely until controls block or viewport edge is hit. Center min
// is handled in allocateSections, not here.
export function clampSectionDivider(
  document: LayoutDocument,
  side: 'left' | 'right',
  proposedWidth: number,
  viewport: { width: number; height: number },
): number {
  const viewportHeight = Math.max(1, viewport.height);
  const available = viewport.width / viewportHeight;
  const sideIndex = side === 'left' ? 0 : 2;
  const otherIndex = side === 'left' ? 2 : 0;
  const sideSection = document.sections[sideIndex];

  const controlMin = getSectionControlMin(sideSection);
  const hardMin = controlMin; // absolute floor + control obstacle; configuredMin is soft
  const MAX = 4;

  let clamped = Math.min(Math.max(proposedWidth, hardMin), MAX);

  // Viewport soft cap: keep a sliver for center/other so preview
  // divider never vanishes. This is not the section "minimum" —
  // it's just viewport visibility. It respects the hard control wall.
  if (Number.isFinite(available) && available > 0) {
    const minVisible = 0.1;
    const maxByViewport = available - minVisible;
    // don't let one side consume the whole viewport
    if (maxByViewport >= hardMin) {
      clamped = Math.min(clamped, maxByViewport);
    }
    // keep at least 0.1 for the other side + center sliver
    const otherWidth = document.sections[otherIndex].relativeWidth;
    const maxByOther = available - otherWidth - minVisible;
    if (Number.isFinite(maxByOther) && maxByOther >= hardMin) {
      // only cap if it wouldn't force below the control wall
      clamped = Math.min(clamped, maxByOther);
    }
  }

  return Math.min(Math.max(clamped, hardMin), MAX);
}

export function updateSectionWidth(
  document: LayoutDocument,
  sectionId: 'left' | 'right',
  nextWidth: number,
): LayoutDocument {
  const next = cloneDocument(document);
  const section = next.sections.find((candidate) => candidate.id === sectionId);
  if (section) section.relativeWidth = nextWidth;
  return next;
}

export function updateControlGeometry(
  document: LayoutDocument,
  controlId: string,
  nextGeometry: Geometry,
): LayoutDocument {
  const next = cloneDocument(document);
  for (const section of next.sections) {
    const control = section.controls.find(
      (candidate) => candidate.id === controlId,
    );
    if (control) {
      control.geometry = nextGeometry;
      break;
    }
  }
  return next;
}

export function getHitzonesOf(
  document: LayoutDocument,
  parentId: string,
): string[] {
  const ids: string[] = [];
  for (const section of document.sections) {
    for (const control of section.controls) {
      if (control.type === 'hitzone' && control.parentId === parentId) {
        ids.push(control.id);
      }
    }
  }
  return ids;
}

export function getSectionOffset(
  document: LayoutDocument,
  sectionId: string,
): number {
  let offset = 0;
  for (const section of document.sections) {
    if (section.id === sectionId) break;
    offset += section.relativeWidth;
  }
  return offset;
}

export function findSectionForGlobalX(
  document: LayoutDocument,
  globalX: number,
): Section {
  let start = 0;
  for (const section of document.sections) {
    const end = start + section.relativeWidth;
    if (globalX < end - 1e-9) return section;
    start = end;
  }
  if (globalX < 0) return document.sections[0];
  return document.sections[document.sections.length - 1];
}

// Viewport-aware helpers that preserve actual pixel position.
// Authored relativeWidth defines the valid clamp range, but the visual
// rects at a given viewport may be narrower (center shrinks, sides scale)
// via allocateSections. Using allocated widths for the global -> local
// conversion keeps the control under the finger without a jump.
function getAllocatedWidths(
  document: LayoutDocument,
  viewport: { width: number; height: number },
): number[] {
  const reference = Math.max(0, viewport.height);
  const available = reference > 0 ? Math.max(0, viewport.width / reference) : 0;
  if (document.sections.length !== 3) return document.sections.map(() => 0);
  const leftW = document.sections[0].relativeWidth;
  const rightW = document.sections[2].relativeWidth;
  const centerMin = document.sections[1].relativeMinWidth ?? 0;
  const EPSILON = 1e-7;
  const idealCenter = available - leftW - rightW;
  if (idealCenter >= centerMin - EPSILON) {
    return [leftW, idealCenter, rightW];
  }
  const sideAvailable = available - centerMin;
  const totalSide = leftW + rightW;
  if (sideAvailable >= -EPSILON) {
    if (totalSide <= EPSILON) return [0, centerMin, 0];
    const t = sideAvailable / totalSide;
    return [leftW * t, centerMin, rightW * t];
  }
  const totalMin = centerMin;
  if (totalMin <= EPSILON) {
    if (available <= EPSILON) return [0, 0, 0];
    const totalAuthored = leftW + rightW + Math.max(centerMin, idealCenter);
    const factor = totalAuthored > 0 ? available / totalAuthored : 0;
    return [
      leftW * factor,
      Math.max(0, available - leftW * factor - rightW * factor),
      rightW * factor,
    ];
  }
  const factor = available / totalMin;
  return [0 * factor, centerMin * factor, 0 * factor];
}

export function getAllocatedSectionOffset(
  document: LayoutDocument,
  sectionId: string,
  viewport: { width: number; height: number },
): number {
  const widths = getAllocatedWidths(document, viewport);
  let offset = 0;
  for (let i = 0; i < document.sections.length; i += 1) {
    if (document.sections[i].id === sectionId) break;
    offset += widths[i];
  }
  return offset;
}

export function getAllocatedSectionWidth(
  document: LayoutDocument,
  sectionId: string,
  viewport: { width: number; height: number },
): number {
  const widths = getAllocatedWidths(document, viewport);
  const idx = document.sections.findIndex((s) => s.id === sectionId);
  return idx >= 0 ? widths[idx] : 0;
}

export function findAllocatedSectionForGlobalX(
  document: LayoutDocument,
  globalX: number,
  viewport: { width: number; height: number },
): Section {
  const widths = getAllocatedWidths(document, viewport);
  let start = 0;
  for (let i = 0; i < document.sections.length; i += 1) {
    const end = start + widths[i];
    if (globalX < end - 1e-9) return document.sections[i];
    start = end;
  }
  if (globalX < 0) return document.sections[0];
  return document.sections[document.sections.length - 1];
}

export function moveControlAcross(
  document: LayoutDocument,
  controlId: string,
  deltaX: number,
  deltaY: number,
  viewport?: { width: number; height: number },
): LayoutDocument {
  const found = findControl(document, controlId);
  if (!found) return document;
  const { control, section } = found;
  const hasViewport = !!viewport && viewport.width > 0 && viewport.height > 0;
  const offset = hasViewport
    ? getAllocatedSectionOffset(document, section.id, viewport)
    : getSectionOffset(document, section.id);
  const width = hasViewport
    ? getAllocatedSectionWidth(document, section.id, viewport)
    : section.relativeWidth;
  const globalX = offset + width / 2 + control.geometry.position.x;
  const globalY = 0.5 + control.geometry.position.y;
  const nextGlobalX = globalX + deltaX;
  const nextGlobalY = globalY + deltaY;
  const target = hasViewport
    ? findAllocatedSectionForGlobalX(document, nextGlobalX, viewport)
    : findSectionForGlobalX(document, nextGlobalX);
  if (target.id === section.id) {
    const next = cloneDocument(document);
    const targetInNext = next.sections.find((s) => s.id === section.id);
    if (!targetInNext) return document;
    const ctrl = targetInNext.controls.find((c) => c.id === controlId);
    if (!ctrl) return document;
    ctrl.geometry = clampDrag(control.geometry, deltaX, deltaY, section);
    return next;
  }
  const targetOffset = hasViewport
    ? getAllocatedSectionOffset(document, target.id, viewport)
    : getSectionOffset(document, target.id);
  const targetWidth = hasViewport
    ? getAllocatedSectionWidth(document, target.id, viewport)
    : target.relativeWidth;
  const newPosX = nextGlobalX - (targetOffset + targetWidth / 2);
  const newPosY = nextGlobalY - 0.5;
  const newGeometry = clampGeometry(
    {
      position: { x: newPosX, y: newPosY },
      size: { ...control.geometry.size },
    },
    target,
  );
  const next = cloneDocument(document);
  const sourceInNext = next.sections.find((s) => s.id === section.id);
  if (!sourceInNext) return document;
  const idx = sourceInNext.controls.findIndex((c) => c.id === controlId);
  if (idx < 0) return document;
  const [moved] = sourceInNext.controls.splice(idx, 1);
  if (!moved) return document;
  moved.geometry = newGeometry;
  const targetInNext = next.sections.find((s) => s.id === target.id);
  if (!targetInNext) return document;
  if (moved.type === 'hitzone' && moved.parentId) {
    const parentIdx = targetInNext.controls.findIndex(
      (c) => c.id === moved.parentId,
    );
    if (parentIdx >= 0) {
      targetInNext.controls.splice(parentIdx + 1, 0, moved);
      return next;
    }
  }
  targetInNext.controls.push(moved);
  return next;
}

export function moveParentWithHitzonesAcross(
  document: LayoutDocument,
  parentId: string,
  deltaX: number,
  deltaY: number,
  viewport?: { width: number; height: number },
): LayoutDocument {
  const found = findControl(document, parentId);
  if (!found || found.control.type === 'hitzone') return document;
  const hitzoneIds = getHitzonesOf(document, parentId);
  const ids = [parentId, ...hitzoneIds];
  const hasViewport = !!viewport && viewport.width > 0 && viewport.height > 0;
  const parentOffset = hasViewport
    ? getAllocatedSectionOffset(document, found.section.id, viewport)
    : getSectionOffset(document, found.section.id);
  const parentWidth = hasViewport
    ? getAllocatedSectionWidth(document, found.section.id, viewport)
    : found.section.relativeWidth;
  const parentGlobalX =
    parentOffset + parentWidth / 2 + found.control.geometry.position.x;
  const nextParentGlobalX = parentGlobalX + deltaX;
  const target = hasViewport
    ? findAllocatedSectionForGlobalX(document, nextParentGlobalX, viewport)
    : findSectionForGlobalX(document, nextParentGlobalX);
  if (target.id === found.section.id) {
    const next = cloneDocument(document);
    for (const id of ids) {
      const orig = findControl(document, id);
      if (!orig) continue;
      for (const section of next.sections) {
        const ctrl = section.controls.find((c) => c.id === id);
        if (ctrl) {
          ctrl.geometry = clampDrag(
            orig.control.geometry,
            deltaX,
            deltaY,
            section,
          );
          break;
        }
      }
    }
    return next;
  }
  const next = cloneDocument(document);
  const movedControls: Control[] = [];
  // Preserve the hitzone's pixel offset from its parent so the gap fill
  // stays exactly where it was relative to the parent. Using the parent's
  // new position + original diff avoids independent clamping drift where
  // the parent and hitzone hit different section walls.
  const parentOrig = found;
  // Compute parent's new local position first (pixel-preserved)
  const targetOffsetForParent = hasViewport
    ? getAllocatedSectionOffset(document, target.id, viewport)
    : getSectionOffset(document, target.id);
  const targetWidthForParent = hasViewport
    ? getAllocatedSectionWidth(document, target.id, viewport)
    : target.relativeWidth;
  const parentNewPosX =
    nextParentGlobalX - (targetOffsetForParent + targetWidthForParent / 2);
  const parentGlobalY = 0.5 + parentOrig.control.geometry.position.y;
  const nextParentGlobalY = parentGlobalY + deltaY;
  const parentNewPosY = nextParentGlobalY - 0.5;
  const parentNewGeom = clampGeometry(
    {
      position: { x: parentNewPosX, y: parentNewPosY },
      size: { ...parentOrig.control.geometry.size },
    },
    target,
  );
  const parentCloned = structuredClone(parentOrig.control) as Control;
  parentCloned.geometry = parentNewGeom;
  movedControls.push(parentCloned);
  for (const id of hitzoneIds) {
    const origFound = findControl(document, id);
    if (!origFound) continue;
    // Keep hitzone at same pixel offset from parent as authored.
    // Height-unit offset is same as pixel offset / ref, ref cancels.
    const offsetX =
      origFound.control.geometry.position.x -
      parentOrig.control.geometry.position.x;
    const offsetY =
      origFound.control.geometry.position.y -
      parentOrig.control.geometry.position.y;
    const hzNewPosX = parentNewGeom.position.x + offsetX;
    const hzNewPosY = parentNewGeom.position.y + offsetY;
    const newGeom = clampGeometry(
      {
        position: { x: hzNewPosX, y: hzNewPosY },
        size: { ...origFound.control.geometry.size },
      },
      target,
    );
    const cloned = structuredClone(origFound.control) as Control;
    cloned.geometry = newGeom;
    movedControls.push(cloned);
  }
  for (const id of ids) {
    for (const section of next.sections) {
      const idx = section.controls.findIndex((c) => c.id === id);
      if (idx >= 0) {
        section.controls.splice(idx, 1);
        break;
      }
    }
  }
  const targetInNext = next.sections.find((s) => s.id === target.id);
  if (!targetInNext) return document;
  for (const mc of movedControls) {
    targetInNext.controls.push(mc);
  }
  return next;
}

export function moveParentWithHitzones(
  document: LayoutDocument,
  parentId: string,
  deltaX: number,
  deltaY: number,
  viewport?: { width: number; height: number },
): LayoutDocument {
  return moveParentWithHitzonesAcross(
    document,
    parentId,
    deltaX,
    deltaY,
    viewport,
  );
}

export function resizeControl(
  document: LayoutDocument,
  controlId: string,
  deltaWidth: number,
  deltaHeight: number,
  locked: boolean,
  deltaLeft = 0,
  deltaTop = 0,
): LayoutDocument {
  const next = cloneDocument(document);
  for (const section of next.sections) {
    const control = section.controls.find(
      (candidate) => candidate.id === controlId,
    );
    if (control) {
      control.geometry = clampResize(
        control.geometry,
        deltaWidth,
        deltaHeight,
        section,
        locked,
        deltaLeft,
        deltaTop,
      );
      break;
    }
  }
  return next;
}

export function pixelsToHeightUnits(
  deltaPx: number,
  viewportHeight: number,
): number {
  if (viewportHeight <= 0) return 0;
  return deltaPx / viewportHeight;
}

export class LayoutHistory {
  private cap: number;
  private stack: LayoutDocument[] = [];
  private index = -1;

  constructor(cap = 50) {
    this.cap = cap;
  }

  get size(): number {
    return this.stack.length;
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  current(): LayoutDocument | undefined {
    return this.stack[this.index];
  }

  reset(initial: LayoutDocument): void {
    this.stack = [cloneDocument(initial)];
    this.index = 0;
  }

  push(document: LayoutDocument): void {
    const cloned = cloneDocument(document);
    const current = this.current();
    if (current && JSON.stringify(current) === JSON.stringify(cloned)) return;
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(cloned);
    if (this.stack.length > this.cap) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  undo(): LayoutDocument | undefined {
    if (!this.canUndo) return undefined;
    this.index -= 1;
    return cloneDocument(this.stack[this.index]);
  }

  redo(): LayoutDocument | undefined {
    if (!this.canRedo) return undefined;
    this.index += 1;
    return cloneDocument(this.stack[this.index]);
  }

  clear(): void {
    this.stack = [];
    this.index = -1;
  }
}

export function duplicateControl(
  document: LayoutDocument,
  controlId: string,
): LayoutDocument {
  const found = findControl(document, controlId);
  if (!found) return document;
  const { control, section } = found;
  const next = cloneDocument(document);
  const targetSection = next.sections.find((s) => s.id === section.id);
  if (!targetSection) return document;
  const sourceIndex = targetSection.controls.findIndex(
    (candidate) => candidate.id === controlId,
  );
  if (sourceIndex < 0) return document;
  const copy = structuredClone(control) as Control;
  copy.id = nextControlId(next);
  copy.geometry = {
    position: {
      x: control.geometry.position.x + 0.05,
      y: control.geometry.position.y + 0.05,
    },
    size: { ...control.geometry.size },
  };
  targetSection.controls.splice(sourceIndex + 1, 0, copy);
  return next;
}

export function nextControlId(document: LayoutDocument): string {
  let max = 0;
  for (const section of document.sections) {
    for (const control of section.controls) {
      const match = control.id.match(/^control-(\d+)$/);
      if (match) max = Math.max(max, Number.parseInt(match[1], 10));
    }
  }
  return `control-${max + 1}`;
}

export function moveControl(
  document: LayoutDocument,
  sectionId: string,
  fromIndex: number,
  toIndex: number,
): LayoutDocument {
  const next = cloneDocument(document);
  const section = next.sections.find((s) => s.id === sectionId);
  if (!section) return document;
  const clampedFrom = Math.max(
    0,
    Math.min(fromIndex, section.controls.length - 1),
  );
  const clampedTo = Math.max(0, Math.min(toIndex, section.controls.length - 1));
  if (clampedFrom === clampedTo) return document;
  const [moved] = section.controls.splice(clampedFrom, 1);
  if (!moved) return document;
  section.controls.splice(clampedTo, 0, moved);
  return next;
}

export function deleteControl(
  document: LayoutDocument,
  controlId: string,
): LayoutDocument {
  const next = cloneDocument(document);
  let deletedIsParent = false;
  for (const section of next.sections) {
    const index = section.controls.findIndex(
      (candidate) => candidate.id === controlId,
    );
    if (index >= 0) {
      const removed = section.controls[index];
      deletedIsParent = removed.type !== 'hitzone';
      section.controls.splice(index, 1);
      break;
    }
  }
  // cascade: if the deleted control was a parent, remove its hitzones
  if (deletedIsParent) {
    for (const section of next.sections) {
      section.controls = section.controls.filter(
        (candidate) => candidate.parentId !== controlId,
      );
    }
  }
  return next;
}

export function slugifyId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-');
}

export function addHitzone(
  document: LayoutDocument,
  parentId: string,
): LayoutDocument | null {
  const found = findControl(document, parentId);
  if (!found || found.control.type === 'hitzone') return null;
  const next = cloneDocument(document);
  const targetSection = next.sections.find((s) => s.id === found.section.id);
  const parent = targetSection?.controls.find((c) => c.id === parentId);
  if (!targetSection || !parent) return null;
  const newId = nextControlId(next);
  const hitzone: Control = {
    id: newId,
    type: 'hitzone',
    geometry: clampGeometry(
      {
        position: {
          x: parent.geometry.position.x + 0.04,
          y: parent.geometry.position.y + 0.04,
        },
        size: { width: 0.08, height: 0.08 },
      },
      targetSection,
    ),
    label: '',
    parentId,
    shape: 'rect',
  };
  const parentIndex = targetSection.controls.findIndex(
    (c) => c.id === parentId,
  );
  targetSection.controls.splice(
    parentIndex + 1,
    0,
    hitzone as unknown as (typeof targetSection.controls)[number],
  );
  return next;
}

export function isDirty(
  draft: LayoutDocument,
  persisted: LayoutDocument,
): boolean {
  return JSON.stringify(draft) !== JSON.stringify(persisted);
}
