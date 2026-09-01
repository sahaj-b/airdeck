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

export function getBindingLabel(command: Command): string {
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

export function isDefaultLocked(control: Control): boolean {
  if (control.type === 'joystick' || control.type === 'dpad') return true;
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

// Clamp proposed side width so center keeps its minimum.
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

  let clamped = Math.max(0.1, Math.min(proposedWidth, available - 0.1));

  const centerWidth = available - clamped - otherWidth;
  if (centerWidth < centerMin) {
    clamped = available - otherWidth - centerMin;
  }
  if (clamped < 0.1) clamped = 0.1;
  if (clamped + otherWidth + centerMin > available) {
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

export function moveParentWithHitzones(
  document: LayoutDocument,
  parentId: string,
  deltaX: number,
  deltaY: number,
): LayoutDocument {
  const hitzoneIds = getHitzonesOf(document, parentId);
  const ids = [parentId, ...hitzoneIds];
  const next = cloneDocument(document);
  for (const id of ids) {
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

export function resizeControl(
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
