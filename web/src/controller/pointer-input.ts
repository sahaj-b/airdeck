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
  target: HTMLElement;
  visual: HTMLElement;
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

  bind(
    target: HTMLElement,
    control: Control,
    visual: HTMLElement = target,
  ): () => void {
    const onPointerDown = (event: PointerEvent) =>
      this.pointerDown(event, target, visual, control);
    const onPointerMove = (event: PointerEvent) => this.pointerMove(event);
    const onPointerUp = (event: PointerEvent) =>
      this.finishPointer(event.pointerId);
    const onPointerCancel = (event: PointerEvent) =>
      this.finishPointer(event.pointerId);
    const onLostPointerCapture = (event: PointerEvent) =>
      this.finishPointer(event.pointerId);
    const onContextMenu = (event: Event) => event.preventDefault();

    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
    target.addEventListener('pointercancel', onPointerCancel);
    target.addEventListener('lostpointercapture', onLostPointerCapture);
    target.addEventListener('contextmenu', onContextMenu);

    const cleanup = () => {
      this.cancelElement(target);
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerCancel);
      target.removeEventListener('lostpointercapture', onLostPointerCapture);
      target.removeEventListener('contextmenu', onContextMenu);
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
    target: HTMLElement,
    visual: HTMLElement,
    control: Control,
  ): void {
    event.preventDefault();
    this.finishPointer(event.pointerId);
    if (!control.binding && control.type !== 'dpad') return;

    const source = `pointer:${event.pointerId}:${control.id}`;
    const ownership: PointerOwnership = { target, visual, control, source };
    this.pointers.set(event.pointerId, ownership);
    this.markElement(visual, event.pointerId, true);
    try {
      target.setPointerCapture(event.pointerId);
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
    const { visual, control, source } = ownership;
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
      if (ownership.command)
        this.state.setButton(source, ownership.command, false);
      ownership.command = command;
      if (command) this.state.setButton(source, command, true);
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
      visual.style.setProperty('--axis-x', `${value.x * 40}%`);
      visual.style.setProperty('--axis-y', `${value.y * 40}%`);
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

  private finishPointer(pointerId: number): void {
    const ownership = this.pointers.get(pointerId);
    if (!ownership) return;
    this.pointers.delete(pointerId);
    this.state.clearSource(ownership.source);
    this.markElement(ownership.visual, pointerId, false);
    ownership.visual.style.setProperty('--axis-x', '0%');
    ownership.visual.style.setProperty('--axis-y', '0%');
    ownership.visual.setAttribute('aria-valuenow', '0');
    ownership.visual.dataset.direction = '';
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
