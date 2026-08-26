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
}

interface PointerOwnership {
  element: HTMLElement;
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
  const rawX = (point.x - centerX) / radiusX;
  const rawY = (point.y - centerY) / radiusY;
  const length = Math.hypot(rawX, rawY);
  const bounded =
    length > 1 ? { x: rawX / length, y: rawY / length } : { x: rawX, y: rawY };
  return applyDeadzone(
    bounded.x,
    bounded.y,
    options.deadzone,
    options.sensitivity,
  );
}

export function normalizeTriggerPoint(point: Point, rect: RectLike): number {
  if (rect.width >= rect.height) {
    return clamp((point.x - rect.left) / Math.max(1, rect.width), 0, 1);
  }
  return clamp(1 - (point.y - rect.top) / Math.max(1, rect.height), 0, 1);
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

  constructor(
    private readonly state: InputStateStore,
    private readonly feedback?: PointerFeedback,
    private readonly joystickOptions: JoystickOptions = {},
  ) {}

  bind(element: HTMLElement, control: Control): () => void {
    const onPointerDown = (event: PointerEvent) =>
      this.pointerDown(event, element, control);
    const onPointerMove = (event: PointerEvent) => this.pointerMove(event);
    const onPointerUp = (event: PointerEvent) =>
      this.finishPointer(event.pointerId);
    const onPointerCancel = (event: PointerEvent) =>
      this.finishPointer(event.pointerId);
    const onLostPointerCapture = (event: PointerEvent) =>
      this.finishPointer(event.pointerId);
    const onContextMenu = (event: Event) => event.preventDefault();

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerCancel);
    element.addEventListener('lostpointercapture', onLostPointerCapture);
    element.addEventListener('contextmenu', onContextMenu);

    const cleanup = () => {
      this.cancelElement(element);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerCancel);
      element.removeEventListener('lostpointercapture', onLostPointerCapture);
      element.removeEventListener('contextmenu', onContextMenu);
    };
    this.cleanups.push(cleanup);
    return cleanup;
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
    element: HTMLElement,
    control: Control,
  ): void {
    event.preventDefault();
    this.finishPointer(event.pointerId);
    if (!control.binding && control.type !== 'dpad') return;

    const source = `pointer:${event.pointerId}:${control.id}`;
    const ownership: PointerOwnership = { element, control, source };
    this.pointers.set(event.pointerId, ownership);
    this.markElement(element, event.pointerId, true);
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable in a few embedded browser contexts.
    }
    this.updatePointer(event, ownership);
    this.feedback?.press();
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
    const { element, control, source } = ownership;
    if (control.type === 'button') {
      if (control.binding) this.state.setButton(source, control.binding, true);
      return;
    }

    const rect = element.getBoundingClientRect();
    if (control.type === 'dpad') {
      const command = dpadDirection(
        { x: event.clientX, y: event.clientY },
        rect,
        control.bindings,
      );
      if (command === ownership.command) return;
      if (ownership.command)
        this.state.setButton(source, ownership.command, false);
      ownership.command = command;
      if (command) this.state.setButton(source, command, true);
      element.dataset.direction = command ?? '';
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
      element.style.setProperty('--axis-x', `${value.x * 40}%`);
      element.style.setProperty('--axis-y', `${value.y * 40}%`);
      return;
    }

    if (
      control.type === 'trigger' &&
      (control.binding === 'leftTrigger' || control.binding === 'rightTrigger')
    ) {
      const value = normalizeTriggerPoint(
        { x: event.clientX, y: event.clientY },
        rect,
      );
      this.state.setTrigger(source, control.binding as TriggerCommand, value);
      element.style.setProperty('--trigger-value', `${value * 100}%`);
      element.setAttribute('aria-valuenow', String(Math.round(value * 255)));
    }
  }

  private finishPointer(pointerId: number): void {
    const ownership = this.pointers.get(pointerId);
    if (!ownership) return;
    this.pointers.delete(pointerId);
    this.state.clearSource(ownership.source);
    this.markElement(ownership.element, pointerId, false);
    ownership.element.style.setProperty('--axis-x', '0%');
    ownership.element.style.setProperty('--axis-y', '0%');
    ownership.element.style.setProperty('--trigger-value', '0%');
    ownership.element.setAttribute('aria-valuenow', '0');
    ownership.element.dataset.direction = '';
  }

  private cancelElement(element: HTMLElement): void {
    for (const [pointerId, ownership] of this.pointers) {
      if (ownership.element === element) this.finishPointer(pointerId);
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
    if (element.getAttribute('aria-pressed') !== null) {
      element.setAttribute('aria-pressed', String(pointers.size > 0));
    }
    if (pointers.size === 0) this.elementPointers.delete(element);
  }
}
