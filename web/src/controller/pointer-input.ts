import type { Command } from '../shared/contracts';
import type { Control } from '../shared/layout';
import type { InputStateStore, StickCommand, TriggerCommand } from './state';

export interface Point {
  x: number;
  y: number;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface JoystickCalibration {
  centerX?: number;
  centerY?: number;
  radiusX?: number;
  radiusY?: number;
}

export interface JoystickOptions {
  deadzone?: number;
  sensitivity?: number;
  calibration?: JoystickCalibration;
}

export interface PointerFeedback {
  press(): void;
  joystickPress?(): void;
  joystickEdge?(): void;
}

export const JOYSTICK_BOUNDARY_THRESHOLD = 0.98;
export const JOYSTICK_REARM_THRESHOLD = 0.85;

interface PointerOwnership {
  target: HTMLElement;
  visual: HTMLElement;
  parentVisual?: HTMLElement;
  control: Control;
  source: string;
  command?: Command;
}

export type StickFeel = 'fixed' | 'floating' | 'following';
export type StickGrab = 'wide' | 'precise';

export interface StickPrefs {
  feel: StickFeel;
  grab: StickGrab;
}

export const DEFAULT_STICK_PREFS: StickPrefs = {
  feel: 'following',
  grab: 'wide',
};

export interface FloatContext {
  sectionEl: HTMLElement;
  floatLayer: HTMLElement;
  feel: StickFeel;
}

interface FloatSession {
  stickId: string;
  ownerPointerId: number;
  source: string;
  binding: StickCommand;
  behavior: 'floating' | 'following';
  driftCenter: Point;
  radiusPx: number;
  sectionEl: HTMLElement;
  floatLayer: HTMLElement;
  stickVisual: HTMLElement;
  originalParent: HTMLElement;
  originalNextSibling: Node | null;
  origLeft: string;
  origTop: string;
  origWidth: string;
  origHeight: string;
}

const defaultJoystickOptions: Required<
  Pick<JoystickOptions, 'deadzone' | 'sensitivity'>
> = {
  deadzone: 0.12,
  sensitivity: 1,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function applyDeadzone(
  x: number,
  y: number,
  deadzone = defaultJoystickOptions.deadzone,
  sensitivity = defaultJoystickOptions.sensitivity,
): Point {
  const length = Math.hypot(x, y);
  const zone = clamp(Number.isFinite(deadzone) ? deadzone : 0, 0, 0.99);
  const scale = Math.max(0, Number.isFinite(sensitivity) ? sensitivity : 1);
  if (length <= zone || length === 0) return { x: 0, y: 0 };
  const normalized = Math.min(1, (length - zone) / (1 - zone)) * scale;
  return {
    x: clamp((x / length) * normalized, -1, 1),
    y: clamp((y / length) * normalized, -1, 1),
  };
}

function clampToUnitCircle(rawX: number, rawY: number): Point {
  const length = Math.hypot(rawX, rawY);
  if (length > 1) return { x: rawX / length, y: rawY / length };
  return { x: rawX, y: rawY };
}

export function normalizeJoystickPoint(
  point: Point,
  rect: RectLike,
  options: JoystickOptions = {},
): Point {
  const calibration = options.calibration ?? {};
  const centerX = rect.left + rect.width / 2 + (calibration.centerX ?? 0);
  const centerY = rect.top + rect.height / 2 + (calibration.centerY ?? 0);
  const radiusX = Math.max(1, (rect.width / 2) * (calibration.radiusX ?? 1));
  const radiusY = Math.max(1, (rect.height / 2) * (calibration.radiusY ?? 1));
  const bounded = clampToUnitCircle(
    (point.x - centerX) / radiusX,
    (point.y - centerY) / radiusY,
  );
  return applyDeadzone(
    bounded.x,
    bounded.y,
    options.deadzone,
    options.sensitivity,
  );
}

export function joystickVisualOffset(point: Point, rect: RectLike): Point {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
  return clampToUnitCircle(
    (point.x - centerX) / radius,
    (point.y - centerY) / radius,
  );
}

export function clampFloatCenter(
  finger: Point,
  direction: Point,
  radiusPx: number,
  sectionRect: RectLike,
): Point {
  const unclamped: Point = {
    x: finger.x - direction.x * radiusPx,
    y: finger.y - direction.y * radiusPx,
  };
  const minX = sectionRect.left + radiusPx;
  const maxX = sectionRect.left + sectionRect.width - radiusPx;
  const minY = sectionRect.top + radiusPx;
  const maxY = sectionRect.top + sectionRect.height - radiusPx;
  if (maxX < minX || maxY < minY) {
    return {
      x: sectionRect.left + sectionRect.width / 2,
      y: sectionRect.top + sectionRect.height / 2,
    };
  }
  return {
    x: Math.max(minX, Math.min(maxX, unclamped.x)),
    y: Math.max(minY, Math.min(maxY, unclamped.y)),
  };
}

export function dpadDirection(
  point: Point,
  rect: RectLike,
  bindings: Control['bindings'],
): Command | undefined {
  if (!bindings) return undefined;
  const x = (point.x - rect.left) / Math.max(1, rect.width) - 0.5;
  const y = (point.y - rect.top) / Math.max(1, rect.height) - 0.5;
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? bindings.left : bindings.right;
  return y < 0 ? bindings.up : bindings.down;
}

export class PointerInput {
  private readonly pointers = new Map<number, PointerOwnership>();
  private readonly floats = new Map<string, FloatSession>();
  private readonly elementPointers = new WeakMap<HTMLElement, Set<number>>();
  private readonly cleanups: (() => void)[] = [];
  private readonly joystickArmed = new Map<string, boolean>();
  private gyroLocked: StickCommand | null = null;

  constructor(
    private readonly state: InputStateStore,
    private readonly feedback?: PointerFeedback,
    private readonly joystickOptions: JoystickOptions = {},
  ) {}

  bind(
    target: HTMLElement,
    control: Control,
    visual: HTMLElement = target,
    parentVisual?: HTMLElement,
    floatCtx?: FloatContext,
  ): () => void {
    const onPointerDown = (event: PointerEvent) =>
      this.pointerDown(event, target, visual, control, parentVisual, floatCtx);
    const onPointerMove = (event: PointerEvent) => this.pointerMove(event);
    const onPointerUp = (event: PointerEvent) =>
      this.finishPointer(event.pointerId);
    const onPointerCancel = (event: PointerEvent) =>
      this.finishPointer(event.pointerId);
    const onLostPointerCapture = (event: PointerEvent) =>
      this.finishPointer(event.pointerId);
    const onContextMenu = (event: Event) => event.preventDefault();
    const onSelectStart = (event: Event) => event.preventDefault();
    const onDragStart = (event: Event) => event.preventDefault();

    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
    target.addEventListener('pointercancel', onPointerCancel);
    target.addEventListener('lostpointercapture', onLostPointerCapture);
    target.addEventListener('contextmenu', onContextMenu);
    target.addEventListener('selectstart', onSelectStart);
    target.addEventListener('dragstart', onDragStart);

    const cleanup = () => {
      this.cancelElement(target);
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerCancel);
      target.removeEventListener('lostpointercapture', onLostPointerCapture);
      target.removeEventListener('contextmenu', onContextMenu);
      target.removeEventListener('selectstart', onSelectStart);
      target.removeEventListener('dragstart', onDragStart);
    };
    this.cleanups.push(cleanup);
    return cleanup;
  }

  setGyroLocked(target: StickCommand | null): void {
    this.gyroLocked = target;
  }

  clear(): void {
    for (const pointerId of [...this.pointers.keys()])
      this.finishPointer(pointerId);
  }

  destroy(): void {
    this.clear();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }

  private pointerDown(
    event: PointerEvent,
    target: HTMLElement,
    visual: HTMLElement,
    control: Control,
    parentVisual?: HTMLElement,
    floatCtx?: FloatContext,
  ): void {
    const floatDecision = this.floatGrabDecision(control, floatCtx);
    if (floatDecision === 'float') {
      this.startFloat(event, target, visual, control, parentVisual, floatCtx);
      return;
    }
    if (floatDecision === 'rejected') {
      event.preventDefault();
      return;
    }
    if (
      this.stickBindingFor(control) !== null &&
      this.gyroLocked === control.binding
    )
      return;
    event.preventDefault();
    this.finishPointer(event.pointerId);
    if (
      !control.binding &&
      control.type !== 'dpad' &&
      !(control.type === 'hitzone' && control.bindings)
    )
      return;

    const source = `pointer:${event.pointerId}:${control.id}`;
    const ownership: PointerOwnership = {
      target,
      visual,
      parentVisual,
      control,
      source,
    };
    this.pointers.set(event.pointerId, ownership);
    this.markElement(visual, event.pointerId, true);
    if (parentVisual) this.markElement(parentVisual, event.pointerId, true);
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable in a few embedded browser contexts.
    }
    this.updatePointer(event, ownership);
    if (control.type === 'joystick') this.feedback?.joystickPress?.();
    else this.feedback?.press();
  }

  private pointerMove(event: PointerEvent): void {
    const floatSession = this.findFloatByOwner(event.pointerId);
    if (floatSession) {
      event.preventDefault();
      this.updateFloat(event, floatSession);
      return;
    }
    const ownership = this.pointers.get(event.pointerId);
    if (!ownership) return;
    event.preventDefault();
    this.updatePointer(event, ownership);
  }

  private stickIdFor(control: Control): string {
    if (control.type === 'hitzone') return control.parentId ?? control.id;
    return control.id;
  }

  private stickBindingFor(control: Control): StickCommand | null {
    if (control.binding === 'leftStick' || control.binding === 'rightStick') {
      return control.binding as StickCommand;
    }
    return null;
  }

  private behaviorFor(floatCtx?: FloatContext): StickFeel {
    const raw = floatCtx?.feel ?? 'fixed';
    if (raw === 'floating' || raw === 'following') return raw;
    return 'fixed';
  }

  private floatGrabDecision(
    control: Control,
    floatCtx?: FloatContext,
  ): 'float' | 'rejected' | 'fixed' {
    if (this.stickBindingFor(control) === null) return 'fixed';
    if (control.type !== 'joystick' && control.type !== 'hitzone')
      return 'fixed';
    if (!floatCtx) return 'fixed';
    if (this.behaviorFor(floatCtx) === 'fixed') return 'fixed';
    if (this.floats.has(this.stickIdFor(control))) return 'rejected';
    if (this.gyroLocked === control.binding) return 'rejected';
    return 'float';
  }

  private startFloat(
    event: PointerEvent,
    target: HTMLElement,
    visual: HTMLElement,
    control: Control,
    parentVisual: HTMLElement | undefined,
    floatCtx: FloatContext | undefined,
  ): void {
    if (!floatCtx) return;
    const stickId = this.stickIdFor(control);
    const binding = this.stickBindingFor(control);
    if (!binding) return;
    const behavior = this.behaviorFor(floatCtx);
    if (behavior === 'fixed') return;
    event.preventDefault();
    this.finishPointer(event.pointerId);
    const stickVisual = parentVisual ?? visual;
    const restRect = stickVisual.getBoundingClientRect();
    const radiusPx = Math.max(1, Math.min(restRect.width, restRect.height) / 2);
    const source = `pointer:${event.pointerId}:${stickId}`;
    const originalParent = stickVisual.parentElement;
    if (!originalParent) return;
    const session: FloatSession = {
      stickId,
      ownerPointerId: event.pointerId,
      source,
      binding,
      behavior,
      driftCenter: { x: event.clientX, y: event.clientY },
      radiusPx,
      sectionEl: floatCtx.sectionEl,
      floatLayer: floatCtx.floatLayer,
      stickVisual,
      originalParent,
      originalNextSibling: stickVisual.nextSibling,
      origLeft: stickVisual.style.left,
      origTop: stickVisual.style.top,
      origWidth: stickVisual.style.width,
      origHeight: stickVisual.style.height,
    };
    this.floats.set(stickId, session);
    const ownership: PointerOwnership = {
      target,
      visual: stickVisual,
      control,
      source,
    };
    this.pointers.set(event.pointerId, ownership);
    this.markElement(stickVisual, event.pointerId, true);
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable in a few embedded browser contexts.
    }
    floatCtx.floatLayer.append(stickVisual);
    this.positionFloatVisual(session);
    stickVisual.classList.add('is-floating-active');
    stickVisual.style.setProperty('--axis-x', '0%');
    stickVisual.style.setProperty('--axis-y', '0%');
    this.state.setStick(source, binding, 0, 0);
    this.feedback?.joystickPress?.();
  }

  private positionFloatVisual(session: FloatSession): void {
    const layerRect = session.floatLayer.getBoundingClientRect();
    const left = session.driftCenter.x - layerRect.left - session.radiusPx;
    const top = session.driftCenter.y - layerRect.top - session.radiusPx;
    const size = session.radiusPx * 2;
    session.stickVisual.style.left = `${left}px`;
    session.stickVisual.style.top = `${top}px`;
    session.stickVisual.style.width = `${size}px`;
    session.stickVisual.style.height = `${size}px`;
  }

  private updateFloat(event: PointerEvent, session: FloatSession): void {
    const finger: Point = { x: event.clientX, y: event.clientY };
    const dx = finger.x - session.driftCenter.x;
    const dy = finger.y - session.driftCenter.y;
    const length = Math.hypot(dx, dy);
    if (
      session.behavior === 'following' &&
      length > session.radiusPx &&
      length > 0
    ) {
      const direction: Point = { x: dx / length, y: dy / length };
      session.driftCenter = clampFloatCenter(
        finger,
        direction,
        session.radiusPx,
        session.sectionEl.getBoundingClientRect(),
      );
      this.positionFloatVisual(session);
    }
    const driftedRect: RectLike = {
      left: session.driftCenter.x - session.radiusPx,
      top: session.driftCenter.y - session.radiusPx,
      width: session.radiusPx * 2,
      height: session.radiusPx * 2,
    };
    this.emitStick(
      session.source,
      session.binding,
      finger,
      driftedRect,
      session.stickVisual,
    );
  }

  private findFloatByOwner(pointerId: number): FloatSession | undefined {
    for (const session of this.floats.values()) {
      if (session.ownerPointerId === pointerId) return session;
    }
    return undefined;
  }

  private endFloatByOwner(pointerId: number): void {
    const session = this.findFloatByOwner(pointerId);
    if (!session) return;
    this.floats.delete(session.stickId);
    this.joystickArmed.delete(session.source);
    this.state.clearSource(session.source);
    session.stickVisual.classList.remove('is-floating-active');
    session.stickVisual.style.setProperty('--axis-x', '0%');
    session.stickVisual.style.setProperty('--axis-y', '0%');
    session.stickVisual.setAttribute('aria-valuenow', '0');
    session.stickVisual.style.left = session.origLeft;
    session.stickVisual.style.top = session.origTop;
    session.stickVisual.style.width = session.origWidth;
    session.stickVisual.style.height = session.origHeight;
    // The original subtree can be gone after a layout rebuild; the next
    // render recreates the visual, so the drifted node is left for GC.
    if (!session.originalParent.isConnected) return;
    if (
      session.originalNextSibling &&
      session.originalNextSibling.parentNode === session.originalParent
    ) {
      session.originalParent.insertBefore(
        session.stickVisual,
        session.originalNextSibling,
      );
    } else {
      session.originalParent.append(session.stickVisual);
    }
  }

  private emitStick(
    source: string,
    binding: StickCommand,
    finger: Point,
    rect: RectLike,
    thumbTarget: HTMLElement,
  ): void {
    const thumb = joystickVisualOffset(finger, rect);
    const output = applyDeadzone(
      thumb.x,
      thumb.y,
      this.joystickOptions.deadzone,
      this.joystickOptions.sensitivity,
    );
    this.state.setStick(source, binding, output.x, output.y);
    thumbTarget.style.setProperty('--axis-x', `${thumb.x * 100}%`);
    thumbTarget.style.setProperty('--axis-y', `${thumb.y * 100}%`);
    this.maybeTriggerJoystickEdge(source, Math.hypot(thumb.x, thumb.y));
  }

  private updatePointer(
    event: PointerEvent,
    ownership: PointerOwnership,
  ): void {
    const { visual, control, source, parentVisual } = ownership;
    if (control.type === 'hitzone') {
      if (control.bindings) {
        const rect = (parentVisual ?? visual).getBoundingClientRect();
        const command = dpadDirection(
          { x: event.clientX, y: event.clientY },
          rect,
          control.bindings,
        );
        if (command === ownership.command) return;
        const prev = ownership.command;
        if (prev) this.state.setButton(source, prev, false);
        ownership.command = command;
        if (command) {
          this.state.setButton(source, command, true);
          if (prev) this.feedback?.press();
        }
        const armNames: Partial<
          Record<Command, 'up' | 'down' | 'left' | 'right'>
        > = {
          dpadUp: 'up',
          dpadDown: 'down',
          dpadLeft: 'left',
          dpadRight: 'right',
        };
        const direction = (command && armNames[command]) || '';
        visual.dataset.direction = direction;
        if (parentVisual) parentVisual.dataset.direction = direction;
        return;
      }
      if (!control.binding) return;
      if (
        control.binding === 'leftTrigger' ||
        control.binding === 'rightTrigger'
      ) {
        this.state.setTrigger(source, control.binding as TriggerCommand, 1);
        visual.setAttribute('aria-valuenow', '255');
        parentVisual?.setAttribute('aria-valuenow', '255');
        return;
      }
      if (control.binding === 'leftStick' || control.binding === 'rightStick') {
        const rect = (parentVisual ?? visual).getBoundingClientRect();
        this.emitStick(
          source,
          control.binding as StickCommand,
          { x: event.clientX, y: event.clientY },
          rect,
          parentVisual ?? visual,
        );
        return;
      }
      this.state.setButton(source, control.binding, true);
      return;
    }
    if (control.type === 'button') {
      if (control.binding) this.state.setButton(source, control.binding, true);
      return;
    }

    const rect = visual.getBoundingClientRect();
    if (control.type === 'dpad') {
      const command = dpadDirection(
        { x: event.clientX, y: event.clientY },
        rect,
        control.bindings,
      );
      if (command === ownership.command) return;
      const prev = ownership.command;
      if (prev) this.state.setButton(source, prev, false);
      ownership.command = command;
      if (command) {
        this.state.setButton(source, command, true);
        if (prev) this.feedback?.press();
      }
      const armNames: Partial<
        Record<Command, 'up' | 'down' | 'left' | 'right'>
      > = {
        dpadUp: 'up',
        dpadDown: 'down',
        dpadLeft: 'left',
        dpadRight: 'right',
      };
      visual.dataset.direction = (command && armNames[command]) || '';
      return;
    }

    if (
      control.type === 'joystick' &&
      (control.binding === 'leftStick' || control.binding === 'rightStick')
    ) {
      // The thumb tracks the finger 1:1 (deadzone only affects the output
      // value), clamped so its center stops at the rim and half the thumb
      // hangs over the base edge, like a physical stick.
      this.emitStick(
        source,
        control.binding as StickCommand,
        { x: event.clientX, y: event.clientY },
        rect,
        visual,
      );
      return;
    }

    if (
      control.type === 'trigger' &&
      (control.binding === 'leftTrigger' || control.binding === 'rightTrigger')
    ) {
      // Triggers act as buttons: full pull while held, neutral on release.
      this.state.setTrigger(source, control.binding as TriggerCommand, 1);
      visual.setAttribute('aria-valuenow', '255');
    }
  }

  private maybeTriggerJoystickEdge(source: string, magnitude: number): void {
    const armed = this.joystickArmed.get(source) ?? true;
    if (armed && magnitude >= JOYSTICK_BOUNDARY_THRESHOLD) {
      this.feedback?.joystickEdge?.();
      this.joystickArmed.set(source, false);
      return;
    }
    if (!armed && magnitude <= JOYSTICK_REARM_THRESHOLD) {
      this.joystickArmed.set(source, true);
    } else if (armed) {
      // ensure entry exists for hysteresis tracking
      if (!this.joystickArmed.has(source)) this.joystickArmed.set(source, true);
    }
  }

  private finishPointer(pointerId: number): void {
    this.endFloatByOwner(pointerId);
    const ownership = this.pointers.get(pointerId);
    if (!ownership) return;
    this.pointers.delete(pointerId);
    this.joystickArmed.delete(ownership.source);
    this.state.clearSource(ownership.source);
    this.markElement(ownership.visual, pointerId, false);
    if (ownership.parentVisual)
      this.markElement(ownership.parentVisual, pointerId, false);
    ownership.visual.style.setProperty('--axis-x', '0%');
    ownership.visual.style.setProperty('--axis-y', '0%');
    ownership.visual.setAttribute('aria-valuenow', '0');
    ownership.visual.dataset.direction = '';
    if (ownership.parentVisual) {
      const stillPressed = this.elementPointers.get(ownership.parentVisual);
      const hasRemaining = !!stillPressed && stillPressed.size > 0;
      if (!hasRemaining) {
        ownership.parentVisual.style.setProperty('--axis-x', '0%');
        ownership.parentVisual.style.setProperty('--axis-y', '0%');
        ownership.parentVisual.setAttribute('aria-valuenow', '0');
        ownership.parentVisual.dataset.direction = '';
      }
    }
  }

  private cancelElement(element: HTMLElement): void {
    for (const [pointerId, ownership] of this.pointers) {
      if (ownership.target === element) this.finishPointer(pointerId);
    }
  }

  private markElement(
    element: HTMLElement,
    pointerId: number,
    active: boolean,
  ): void {
    let pointers = this.elementPointers.get(element);
    if (!pointers) {
      pointers = new Set<number>();
      this.elementPointers.set(element, pointers);
    }
    if (active) pointers.add(pointerId);
    else pointers.delete(pointerId);
    element.classList.toggle('is-pressed', pointers.size > 0);
    element.classList.toggle('is-active', pointers.size > 0);
    if (element.classList.contains('control-joystick')) {
      element.classList.toggle('is-dragging', pointers.size > 0);
    }
    if (element.getAttribute('aria-pressed') !== null) {
      element.setAttribute('aria-pressed', String(pointers.size > 0));
    }
    if (pointers.size === 0) this.elementPointers.delete(element);
  }
}
