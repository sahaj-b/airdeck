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
  ): () => void {
    const onPointerDown = (event: PointerEvent) =>
      this.pointerDown(event, target, visual, control, parentVisual);
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
  ): void {
    if (
      control.binding &&
      this.gyroLocked === control.binding &&
      (control.type === 'joystick' ||
        (control.type === 'hitfill' &&
          (control.binding === 'leftStick' ||
            control.binding === 'rightStick')))
    )
      return;
    event.preventDefault();
    this.finishPointer(event.pointerId);
    if (
      !control.binding &&
      control.type !== 'dpad' &&
      !(control.type === 'hitfill' && control.bindings)
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
    const ownership = this.pointers.get(event.pointerId);
    if (!ownership) return;
    event.preventDefault();
    this.updatePointer(event, ownership);
  }

  private updatePointer(
    event: PointerEvent,
    ownership: PointerOwnership,
  ): void {
    const { visual, control, source, parentVisual } = ownership;
    if (control.type === 'hitfill') {
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
        const value = normalizeJoystickPoint(
          { x: event.clientX, y: event.clientY },
          rect,
          this.joystickOptions,
        );
        this.state.setStick(
          source,
          control.binding as StickCommand,
          value.x,
          value.y,
        );
        const thumbOffset = joystickVisualOffset(
          { x: event.clientX, y: event.clientY },
          rect,
        );
        const thumbTarget = parentVisual ?? visual;
        thumbTarget.style.setProperty('--axis-x', `${thumbOffset.x * 100}%`);
        thumbTarget.style.setProperty('--axis-y', `${thumbOffset.y * 100}%`);
        this.maybeTriggerJoystickEdge(
          source,
          Math.hypot(thumbOffset.x, thumbOffset.y),
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
      const value = normalizeJoystickPoint(
        { x: event.clientX, y: event.clientY },
        rect,
        this.joystickOptions,
      );
      this.state.setStick(
        source,
        control.binding as StickCommand,
        value.x,
        value.y,
      );
      // The thumb tracks the finger 1:1 (deadzone only affects the output
      // value), clamped so its center stops at the rim and half the thumb
      // hangs over the base edge, like a physical stick.
      const thumbOffset = joystickVisualOffset(
        { x: event.clientX, y: event.clientY },
        rect,
      );
      visual.style.setProperty('--axis-x', `${thumbOffset.x * 100}%`);
      visual.style.setProperty('--axis-y', `${thumbOffset.y * 100}%`);
      this.maybeTriggerJoystickEdge(
        source,
        Math.hypot(thumbOffset.x, thumbOffset.y),
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
