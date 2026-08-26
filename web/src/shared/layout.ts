import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import type { Command, Orientation } from './contracts';
import { ButtonBits } from './contracts';
import schema from './layout.schema.json';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface OrientationOverrides {
  portrait?: Rect;
  landscape?: Rect;
}
export interface DPadBindings {
  up: 'dpadUp';
  down: 'dpadDown';
  left: 'dpadLeft';
  right: 'dpadRight';
}
export type ControlType =
  | 'button'
  | 'dpad'
  | 'joystick'
  | 'trigger'
  | 'label'
  | 'image';
export interface Control {
  id: string;
  type: ControlType;
  rect: Rect;
  label: string;
  visible: boolean;
  binding?: Command;
  bindings?: DPadBindings;
  orientations?: OrientationOverrides;
  asset?: string;
}
export interface Section {
  id: string;
  rect: Rect;
  controls: Control[];
}
export interface LayoutAsset {
  id: string;
  path: string;
}
export interface LayoutDocument {
  id: string;
  name: string;
  schemaVersion: 1;
  defaultOrientation: Orientation;
  sections: Section[];
  assets: LayoutAsset[];
}

const validateSchema: ValidateFunction = new Ajv2020({
  allErrors: true,
  strict: false,
}).compile(schema);
const idPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const safeAsset = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/;

export function validateLayout(value: unknown): value is LayoutDocument {
  if (!validateSchema(value)) return false;
  const document = value as LayoutDocument;
  if (!idPattern.test(document.id)) return false;
  const ids = new Set<string>();
  const add = (id: string) => {
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  };
  if (!add(document.id)) return false;
  const assetIds = new Set<string>();
  for (const asset of document.assets) {
    if (
      !add(asset.id) ||
      assetIds.has(asset.id) ||
      !safeAsset.test(asset.path) ||
      asset.path.includes('..')
    )
      return false;
    assetIds.add(asset.id);
  }
  for (const section of document.sections) {
    if (!add(section.id) || !validRect(section.rect)) return false;
    for (const control of section.controls) {
      if (!add(control.id) || !validRect(control.rect)) return false;
      if (
        control.type === 'image' &&
        (!control.asset || !assetIds.has(control.asset))
      )
        return false;
      if (control.binding && !knownCommand(control.binding)) return false;
      if (control.type === 'label' && control.binding) return false;
      if (
        control.type === 'dpad' &&
        (control.bindings?.up !== 'dpadUp' ||
          control.bindings?.down !== 'dpadDown' ||
          control.bindings?.left !== 'dpadLeft' ||
          control.bindings?.right !== 'dpadRight')
      )
        return false;
      if (
        control.orientations &&
        Object.values(control.orientations).some(
          (rect) => rect && !validRect(rect),
        )
      )
        return false;
    }
  }
  return true;
}

function validRect(rect: Rect): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= 1 &&
    rect.y + rect.height <= 1
  );
}
const KNOWN_COMMANDS = new Set<string>([
  ...Object.keys(ButtonBits),
  'leftTrigger',
  'rightTrigger',
]);
function knownCommand(command: string): command is Command {
  return KNOWN_COMMANDS.has(command);
}

export function orientationRect(
  control: Control,
  orientation: Orientation,
): Rect {
  return control.orientations?.[orientation] ?? control.rect;
}
