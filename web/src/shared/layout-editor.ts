import type {
  Control,
  Geometry,
  Document as LayoutDocument,
  Section,
} from './generated/layout';
import type { Command } from './generated/protocol';

export const SECTION_IDS = ['left', 'center', 'right'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const FACE_BINDINGS = new Set<Command>([
  'south',
  'west',
  'east',
  'north',
] as Command[]);

export interface BindingLabel {
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

export function getBindingLabel(command: Command): string {
  return BINDING_LABELS[command]?.dual ?? command;
}

export function getBindingMeta(command: string): BindingLabel | undefined {
  return BINDING_LABELS[command];
}

export function getAllBindingLabels(): BindingLabel[] {
  return Object.values(BINDING_LABELS);
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
    case 'image':
      return [];
    default:
      return Object.keys(BINDING_LABELS) as Command[];
  }
}

export function isDefaultLocked(control: Control): boolean {
  if (control.type === 'joystick' || control.type === 'dpad') return true;
  if (
    control.type === 'button' &&
    control.binding &&
    FACE_BINDINGS.has(control.binding as Command)
  )
    return true;
  return false;
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

export function authoredBounds(
  geometry: Geometry,
  section: Section,
): { left: number; right: number; top: number; bottom: number } {
  const contentWidth = section.relativeWidth;
  const centerX = contentWidth / 2;
  const centerY = 0.5;
  const left = centerX + geometry.position.x - geometry.size.width / 2;
  const right = left + geometry.size.width;
  const top = centerY + geometry.position.y - geometry.size.height / 2;
  const bottom = top + geometry.size.height;
  return { left, right, top, bottom };
}

export function isGeometryInsideSection(
  geometry: Geometry,
  section: Section,
): boolean {
  const bounds = authoredBounds(geometry, section);
  const epsilon = 1e-9;
  return (
    bounds.left >= -epsilon &&
    bounds.right <= section.relativeWidth + epsilon &&
    bounds.top >= -epsilon &&
    bounds.bottom <= 1 + epsilon
  );
}

export function clampGeometry(geometry: Geometry, section: Section): Geometry {
  const contentWidth = section.relativeWidth;
  const contentHeight = 1;
  const centerX = contentWidth / 2;
  const centerY = contentHeight / 2;
  let { x, y } = geometry.position;
  let { width, height } = geometry.size;

  // Clamp size first: cannot exceed section
  width = Math.min(Math.max(width, 0.01), Math.min(2, contentWidth));
  height = Math.min(Math.max(height, 0.01), Math.min(2, contentHeight));

  // Ensure position keeps rect inside bounds after size clamp
  const halfW = width / 2;
  const halfH = height / 2;
  const minX = halfW - centerX;
  const maxX = contentWidth - halfW - centerX;
  const minY = halfH - centerY;
  const maxY = 1 - halfH - centerY;
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
): Geometry {
  let width = geometry.size.width + deltaWidth;
  let height = geometry.size.height + deltaHeight;
  if (locked) {
    const ratio = geometry.size.width / geometry.size.height || 1;
    if (Math.abs(deltaWidth) > Math.abs(deltaHeight)) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
  }
  const next: Geometry = {
    position: { ...geometry.position },
    size: { width, height },
  };
  return clampGeometry(next, section);
}

export function resolvedBounds(
  geometry: Geometry,
  sectionRect: { left: number; top: number; width: number; height: number },
  viewportHeight: number,
): { left: number; top: number; width: number; height: number } {
  const width = geometry.size.width * viewportHeight;
  const height = geometry.size.height * viewportHeight;
  const centerX = sectionRect.left + sectionRect.width / 2;
  const centerY = sectionRect.top + sectionRect.height / 2;
  return {
    left: centerX + geometry.position.x * viewportHeight - width / 2,
    top: centerY + geometry.position.y * viewportHeight - height / 2,
    width,
    height,
  };
}

// Section divider clamping. Left/right widths are in height units.
// Center is auto viewport - left - right. Clamp proposed side width so center respects its min and sides stay non-negative.
export function clampSectionDivider(
  document: LayoutDocument,
  side: 'left' | 'right',
  proposedWidth: number,
  viewport: { width: number; height: number },
): number {
  const viewportHeight = Math.max(1, viewport.height);
  const available = viewport.width / viewportHeight;
  const centerMin = document.sections[1].relativeMinWidth ?? 0;
  const leftCurrent = document.sections[0].relativeWidth;
  const rightCurrent = document.sections[2].relativeWidth;
  const otherWidth = side === 'left' ? rightCurrent : leftCurrent;

  // Minimal side width guard: at least 0.2 height units, and at most available
  let clamped = Math.max(0.1, Math.min(proposedWidth, available - 0.1));

  // Ensure center gets its minimum
  const centerWidth = available - clamped - otherWidth;
  if (centerWidth < centerMin) {
    clamped = available - otherWidth - centerMin;
  }
  // If still negative or overflow, proportional fallback similar to resolver
  if (clamped < 0.1) clamped = 0.1;
  if (clamped + otherWidth + centerMin > available) {
    // Need to scale sides proportionally if viewport extremely narrow
    // Keep ratio of proposed to other
    const sideAvailable = Math.max(0, available - centerMin);
    const totalSide = clamped + otherWidth;
    if (totalSide > 0) {
      const factor = sideAvailable / totalSide;
      clamped = clamped * factor;
    }
  }
  return Math.max(0, clamped);
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

// XYAB filler linking: face button + hitOnly fillers sharing same binding are linked.
export function getLinkedGroup(
  document: LayoutDocument,
  controlId: string,
): string[] {
  const entry = findControl(document, controlId);
  if (!entry) return [controlId];
  const { control, section } = entry;
  const binding = control.binding;
  if (!binding || !FACE_BINDINGS.has(binding as Command)) return [controlId];
  return section.controls
    .filter((candidate) => candidate.binding === binding)
    .map((candidate) => candidate.id);
}

export function moveLinkedGroup(
  document: LayoutDocument,
  controlId: string,
  deltaX: number,
  deltaY: number,
): LayoutDocument {
  const group = getLinkedGroup(document, controlId);
  const next = cloneDocument(document);
  for (const id of group) {
    for (const section of next.sections) {
      const control = section.controls.find((candidate) => candidate.id === id);
      if (control) {
        control.geometry = clampDrag(control.geometry, deltaX, deltaY, section);
        break;
      }
    }
  }
  return next;
}

export function resizeLinkedGroup(
  document: LayoutDocument,
  controlId: string,
  deltaWidth: number,
  deltaHeight: number,
  locked: boolean,
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
      );
      break;
    }
  }
  return next;
}

// Used by canvas to compute delta from pixel deltas
export function pixelsToHeightUnits(
  deltaPx: number,
  viewportHeight: number,
): number {
  if (viewportHeight <= 0) return 0;
  return deltaPx / viewportHeight;
}

// History state machine: 50 entries, dragend granularity, group as one.
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

export function isDirty(
  draft: LayoutDocument,
  persisted: LayoutDocument,
): boolean {
  return JSON.stringify(draft) !== JSON.stringify(persisted);
}
