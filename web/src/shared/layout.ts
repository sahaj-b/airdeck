import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import defaultLayout from '../layouts/xbox-default.json';
import type { Command, Orientation } from './contracts';
import { ButtonBits } from './contracts';
import schema from './layout.schema.json';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Geometry {
  position: Point;
  anchor: Point;
  size: Size;
}

export interface OrientationOverrides {
  portrait?: Geometry;
  landscape?: Geometry;
}

export interface Padding {
  left: number;
  right: number;
  top: number;
  bottom: number;
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
export type ControlShape = 'circle' | 'pill' | 'rect';
export interface Control {
  id: string;
  type: ControlType;
  geometry: Geometry;
  label: string;
  visible: boolean;
  hitOnly?: boolean;
  shape?: ControlShape;
  binding?: Command;
  bindings?: DPadBindings;
  orientations?: OrientationOverrides;
  asset?: string;
}
export interface Section {
  id: string;
  aspectRatio: number;
  minWidth: number;
  maxWidth: number;
  flexGrow: number;
  flexShrink: number;
  protected: boolean;
  padding: Padding;
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
  referenceDimension: 'height';
  gap: number;
  gapMax: number;
  sections: Section[];
  assets: LayoutAsset[];
}

const validateSchema: ValidateFunction = new Ajv2020({
  allErrors: true,
  strict: false,
}).compile(schema);
const idPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const safeAsset = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/;

export const DEFAULT_LAYOUT: LayoutDocument = defaultLayout as LayoutDocument;

export interface LayoutParseResult {
  layout: LayoutDocument;
  diagnostic?: string;
}

export function validateLayout(value: unknown): value is LayoutDocument {
  if (!validateSchema(value)) return false;
  const document = value as LayoutDocument;
  if (!idPattern.test(document.id)) return false;
  if (
    document.referenceDimension !== 'height' ||
    !Number.isFinite(document.gap) ||
    !Number.isFinite(document.gapMax) ||
    document.gap < 0 ||
    document.gapMax < document.gap
  )
    return false;

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
    if (!add(section.id) || !validSection(section)) return false;
    for (const control of section.controls) {
      if (!add(control.id) || !validControl(control, section, assetIds))
        return false;
    }
  }
  return true;
}

export function parseLayoutDocument(value: unknown): LayoutParseResult {
  if (validateLayout(value)) return { layout: value };
  return {
    layout: DEFAULT_LAYOUT,
    diagnostic:
      'The host sent an invalid layout. The default layout is being used.',
  };
}

function validSection(section: Section): boolean {
  return (
    finitePositive(section.aspectRatio) &&
    finitePositive(section.minWidth) &&
    finitePositive(section.maxWidth) &&
    section.maxWidth >= section.minWidth &&
    finiteNonNegative(section.flexGrow) &&
    finiteNonNegative(section.flexShrink) &&
    validPadding(section.padding) &&
    section.padding.left + section.padding.right < section.minWidth &&
    section.padding.top + section.padding.bottom < 1
  );
}

function validPadding(padding: Padding): boolean {
  return [padding.left, padding.right, padding.top, padding.bottom].every(
    (value) => finiteNonNegative(value) && value <= 0.5,
  );
}

function validControl(
  control: Control,
  section: Section,
  assetIds: Set<string>,
): boolean {
  if (!validGeometry(control.geometry, section)) return false;
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
      (geometry) => geometry && !validGeometry(geometry, section),
    )
  )
    return false;
  if (
    control.shape &&
    control.shape !== 'circle' &&
    control.shape !== 'pill' &&
    control.shape !== 'rect'
  )
    return false;
  if (control.type === 'joystick' || control.type === 'dpad') {
    const geometries = [
      control.geometry,
      control.orientations?.portrait,
      control.orientations?.landscape,
    ];
    if (geometries.some((geometry) => geometry && !isSquare(geometry.size)))
      return false;
  }
  return true;
}

function validGeometry(geometry: Geometry, section: Section): boolean {
  if (
    ![geometry.position.x, geometry.position.y].every(
      (value) => Number.isFinite(value) && value >= -2 && value <= 2,
    ) ||
    ![geometry.anchor.x, geometry.anchor.y].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ) ||
    ![geometry.size.width, geometry.size.height].every(
      (value) => Number.isFinite(value) && value > 0 && value <= 2,
    )
  )
    return false;

  const contentWidth =
    section.aspectRatio - section.padding.left - section.padding.right;
  const contentHeight = 1 - section.padding.top - section.padding.bottom;
  const centerX = section.padding.left + contentWidth / 2;
  const centerY = section.padding.top + contentHeight / 2;
  const left =
    centerX + geometry.position.x - geometry.anchor.x * geometry.size.width;
  const right = left + geometry.size.width;
  const top =
    centerY + geometry.position.y - geometry.anchor.y * geometry.size.height;
  const bottom = top + geometry.size.height;
  const epsilon = 1e-9;
  return (
    left >= -epsilon &&
    right <= section.aspectRatio + epsilon &&
    top >= -epsilon &&
    bottom <= 1 + epsilon
  );
}

function isSquare(size: Size): boolean {
  return Math.abs(size.width - size.height) < 1e-9;
}

const KNOWN_COMMANDS = new Set<string>([
  ...Object.keys(ButtonBits),
  'leftTrigger',
  'rightTrigger',
]);
function knownCommand(command: string): command is Command {
  return KNOWN_COMMANDS.has(command);
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function orientationGeometry(
  control: Control,
  orientation: Orientation,
): Geometry {
  return control.orientations?.[orientation] ?? control.geometry;
}
