import { ButtonBits, type Command } from '../shared/contracts';

export interface InputState {
  buttons: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  lt: number;
  rt: number;
}

export type DigitalCommand = keyof typeof ButtonBits;
export type StickCommand = 'leftStick' | 'rightStick';
export type TriggerCommand = 'leftTrigger' | 'rightTrigger';

export const neutralState: InputState = {
  buttons: 0,
  lx: 0,
  ly: 0,
  rx: 0,
  ry: 0,
  lt: 0,
  rt: 0,
};

export function createNeutralState(): InputState {
  return { ...neutralState };
}

export function cloneState(state: InputState): InputState {
  return { ...state };
}

export function statesEqual(left: InputState, right: InputState): boolean {
  return (
    left.buttons === right.buttons &&
    left.lx === right.lx &&
    left.ly === right.ly &&
    left.rx === right.rx &&
    left.ry === right.ry &&
    left.lt === right.lt &&
    left.rt === right.rt
  );
}

export function isDigitalCommand(command: Command): command is DigitalCommand {
  return command in ButtonBits;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function axisToWire(value: number): number {
  const normalized = clampUnit(value);
  return normalized <= -1 ? -32768 : Math.round(normalized * 32767);
}

function triggerToWire(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

interface StickValue {
  x: number;
  y: number;
}

export type StateListener = (state: InputState) => void;

export class InputStateStore {
  private current: InputState = createNeutralState();
  private readonly buttonSources = new Map<string, Set<DigitalCommand>>();
  private readonly stickSources = new Map<
    string,
    Map<StickCommand, StickValue>
  >();
  private readonly triggerSources = new Map<
    string,
    Map<TriggerCommand, number>
  >();
  private readonly listeners = new Set<StateListener>();

  get state(): InputState {
    return cloneState(this.current);
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setButton(source: string, command: Command, pressed: boolean): boolean {
    if (!isDigitalCommand(command)) return false;
    let commands = this.buttonSources.get(source);
    const hadCommand = commands?.has(command) ?? false;
    if (pressed === hadCommand) return false;

    if (pressed) {
      if (!commands) {
        commands = new Set<DigitalCommand>();
        this.buttonSources.set(source, commands);
      }
      commands.add(command);
    } else if (commands) {
      commands.delete(command);
      if (commands.size === 0) this.buttonSources.delete(source);
    }
    this.recompute();
    return true;
  }

  setStick(
    source: string,
    command: StickCommand,
    x: number,
    y: number,
  ): boolean {
    const values =
      this.stickSources.get(source) ?? new Map<StickCommand, StickValue>();
    const next = { x: clampUnit(x), y: clampUnit(y) };
    const previous = values.get(command);
    if (previous && previous.x === next.x && previous.y === next.y)
      return false;
    values.set(command, next);
    this.stickSources.set(source, values);
    this.recompute();
    return true;
  }

  setTrigger(source: string, command: TriggerCommand, value: number): boolean {
    const values =
      this.triggerSources.get(source) ?? new Map<TriggerCommand, number>();
    const next = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    const previous = values.get(command);
    if (previous === next) return false;
    values.set(command, next);
    this.triggerSources.set(source, values);
    this.recompute();
    return true;
  }

  clearSource(source: string): boolean {
    const buttonChanged = this.buttonSources.delete(source);
    const stickChanged = this.stickSources.delete(source);
    const triggerChanged = this.triggerSources.delete(source);
    const changed = buttonChanged || stickChanged || triggerChanged;
    if (changed) this.recompute();
    return changed;
  }

  reset(): boolean {
    const changed = !statesEqual(this.current, neutralState);
    this.buttonSources.clear();
    this.stickSources.clear();
    this.triggerSources.clear();
    if (changed) {
      this.current = createNeutralState();
      this.notify();
    }
    return changed;
  }

  private recompute(): void {
    const next = createNeutralState();
    for (const commands of this.buttonSources.values()) {
      for (const command of commands) next.buttons |= ButtonBits[command];
    }

    const sticks = new Map<StickCommand, StickValue>();
    for (const values of this.stickSources.values()) {
      for (const [command, value] of values) sticks.set(command, value);
    }
    const leftStick = sticks.get('leftStick') ?? { x: 0, y: 0 };
    const rightStick = sticks.get('rightStick') ?? { x: 0, y: 0 };
    next.lx = axisToWire(leftStick.x);
    next.ly = axisToWire(leftStick.y);
    next.rx = axisToWire(rightStick.x);
    next.ry = axisToWire(rightStick.y);

    const triggers = new Map<TriggerCommand, number>();
    for (const values of this.triggerSources.values()) {
      for (const [command, value] of values) triggers.set(command, value);
    }
    next.lt = triggerToWire(triggers.get('leftTrigger') ?? 0);
    next.rt = triggerToWire(triggers.get('rightTrigger') ?? 0);

    if (!statesEqual(this.current, next)) {
      this.current = next;
      this.notify();
    }
  }

  private notify(): void {
    const snapshot = this.state;
    for (const listener of this.listeners) listener(snapshot);
  }
}
