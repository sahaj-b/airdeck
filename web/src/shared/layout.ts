import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import defaultLayout from '../layouts/xbox-default.json';
import {
  CommandBack,
  CommandDPadDown,
  CommandDPadLeft,
  CommandDPadRight,
  CommandDPadUp,
  CommandEast,
  CommandGuide,
  CommandLeftShoulder,
  CommandLeftStick,
  CommandLeftTrigger,
  CommandNorth,
  CommandRightShoulder,
  CommandRightStick,
  CommandRightTrigger,
  CommandSouth,
  CommandStart,
  CommandWest,
} from './generated/protocol';
import schema from './layout.schema.json';

// Re-export generated types as SSOT. Go is canonical.
export type {
  Control,
  Document as LayoutDocument,
  DPadBindings,
  Geometry,
  Point,
  Section,
  Size,
  Summary as LayoutSummary,
} from './generated/layout';

import type {
  Control,
  Geometry,
  Document as LayoutDocument,
  Section,
} from './generated/layout';

export type ControlType = Control['type'];
export type ControlShape = NonNullable<Control['shape']>;
export type Orientation = 'landscape' | 'portrait';

export const LAYOUT_SECTION_IDS = ['left', 'center', 'right'] as const;
export type LayoutSectionId = (typeof LAYOUT_SECTION_IDS)[number];

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const validateSchema: ValidateFunction = new Ajv2020({
  allErrors: true,
  strict: false,
}).compile(schema);

const parentIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// Authored width must equal height within this epsilon (height units).
const JOYSTICK_SQUARE_EPSILON = 0.001;

export const DEFAULT_LAYOUT: LayoutDocument = defaultLayout as LayoutDocument;

export interface LayoutParseResult {
  layout: LayoutDocument;
  diagnostic?: string;
}

export function validateLayout(value: unknown): value is LayoutDocument {
  if (!validateSchema(value)) return false;
  const document = value as LayoutDocument;
  if (document.sections.length !== 3) return false;
  const expected: string[] = ['left', 'center', 'right'];
  for (let i = 0; i < 3; i += 1) {
    if (document.sections[i].id !== expected[i]) return false;
  }
  const ids = new Set<string>();
  const add = (id: string) => {
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  };
  if (!add(document.id)) return false;
  for (const section of document.sections) {
    if (!add(section.id) || !validSection(section)) return false;
    for (const control of section.controls) {
      if (!add(control.id) || !validControl(control, section)) return false;
    }
  }
  // hitzone parent relation second pass (cross-section allowed)
  const controlById = new Map<string, Control>();
  for (const section of document.sections) {
    for (const control of section.controls) {
      controlById.set(control.id, control);
    }
  }
  for (const section of document.sections) {
    for (const control of section.controls) {
      if (control.type === 'hitzone') {
        if (!control.parentId) return false;
        if (control.parentId === control.id) return false;
        const parent = controlById.get(control.parentId);
        if (!parent) return false;
        if (parent.type === 'hitzone') return false;
      }
    }
  }
  return true;
}

export function getValidationErrors(value: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const ok = validateSchema(value);
  if (!ok) {
    for (const error of validateSchema.errors ?? []) {
      errors.push({
        path: error.instancePath || '/',
        message: error.message ?? 'schema error',
      });
    }
    return errors;
  }
  const document = value as LayoutDocument;
  if (document.sections.length !== 3)
    errors.push({
      path: '/sections',
      message: 'layout must contain exactly 3 sections',
    });
  const expected: string[] = ['left', 'center', 'right'];
  for (let i = 0; i < 3; i += 1) {
    if (document.sections[i]?.id !== expected[i])
      errors.push({
        path: `/sections/${i}/id`,
        message: `section ${i} must be ${expected[i]}`,
      });
  }
  const seen = new Map<string, string>();
  const checkId = (id: string, kind: string, path: string) => {
    if (!id) errors.push({ path, message: `${kind} id is required` });
    else if (seen.has(id))
      errors.push({
        path,
        message: `duplicate id ${id} used by ${seen.get(id)} and ${kind}`,
      });
    else seen.set(id, kind);
  };
  checkId(document.id, 'document', '/id');
  for (const section of document.sections ?? []) {
    checkId(section.id, 'section', `/sections/${section.id}`);
    if (!finitePositive(section.relativeWidth) || section.relativeWidth > 4)
      errors.push({
        path: `/sections/${section.id}/relativeWidth`,
        message: 'relativeWidth is invalid',
      });
    if (section.id !== 'center' && section.relativeMinWidth !== undefined)
      errors.push({
        path: `/sections/${section.id}/relativeMinWidth`,
        message: 'relativeMinWidth is only allowed on center section',
      });
    else if (
      section.relativeMinWidth !== undefined &&
      (!finitePositive(section.relativeMinWidth) ||
        section.relativeMinWidth > 4)
    )
      errors.push({
        path: `/sections/${section.id}/relativeMinWidth`,
        message: 'relativeMinWidth is invalid',
      });
    for (const control of section.controls ?? []) {
      checkId(
        control.id,
        'control',
        `/sections/${section.id}/controls/${control.id}`,
      );
      const controlErrors = getControlErrors(control, section);
      for (const error of controlErrors)
        errors.push({
          path: `/sections/${section.id}/controls/${control.id}/${error.path}`,
          message: error.message,
        });
    }
  }
  // second pass for hitzone parent relation (cross-section allowed)
  if (document.sections) {
    const controlById = new Map<string, Control>();
    for (const section of document.sections) {
      for (const control of section.controls ?? []) {
        controlById.set(control.id, control);
      }
    }
    for (const section of document.sections) {
      for (const control of section.controls ?? []) {
        if (control.type === 'hitzone') {
          const parentId = control.parentId;
          if (!parentId) {
            errors.push({
              path: `/sections/${section.id}/controls/${control.id}/parentId`,
              message: 'hitzone requires parentId',
            });
            continue;
          }
          if (parentId === control.id) {
            errors.push({
              path: `/sections/${section.id}/controls/${control.id}/parentId`,
              message: 'parentId must not be self',
            });
            continue;
          }
          const parent = controlById.get(parentId);
          if (!parent) {
            errors.push({
              path: `/sections/${section.id}/controls/${control.id}/parentId`,
              message: `parentId ${parentId} does not exist`,
            });
            continue;
          }
          if (parent.type === 'hitzone') {
            errors.push({
              path: `/sections/${section.id}/controls/${control.id}/parentId`,
              message: 'parentId must not reference another hitzone',
            });
          }
        }
      }
    }
  }
  return errors;
}

export function validateLayoutDetailed(value: unknown): ValidationResult {
  const errors = getValidationErrors(value);
  return { valid: errors.length === 0, errors };
}

export function getControlErrors(
  control: Control,
  section: Section,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!validGeometry(control.geometry, section))
    errors.push({
      path: 'geometry',
      message: 'geometry center is outside section bounds or has invalid size',
    });
  if (control.type === 'joystick') {
    const w = control.geometry?.size?.width;
    const h = control.geometry?.size?.height;
    if (
      typeof w === 'number' &&
      typeof h === 'number' &&
      Math.abs(w - h) > JOYSTICK_SQUARE_EPSILON
    ) {
      errors.push({
        path: 'geometry',
        message: 'joystick geometry must be square',
      });
    }
  }
  const isHitzone = control.type === 'hitzone';
  if (isHitzone) {
    if (!control.parentId) {
      errors.push({ path: 'parentId', message: 'hitzone requires parentId' });
    } else if (!parentIdPattern.test(control.parentId)) {
      errors.push({
        path: 'parentId',
        message: `invalid parentId ${control.parentId}`,
      });
    }
    if (
      control.shape &&
      control.shape !== 'round' &&
      control.shape !== 'rect'
    ) {
      errors.push({
        path: 'shape',
        message: `unsupported shape ${control.shape}`,
      });
    }
    if ((control as Control & { hitShape?: string }).hitShape) {
      errors.push({
        path: 'hitShape',
        message: 'hitzone must not have hitShape',
      });
    }
    if (control.binding) {
      errors.push({
        path: 'binding',
        message: 'hitzone must not have a binding',
      });
    }
    if (control.bindings) {
      errors.push({
        path: 'bindings',
        message: 'hitzone must not have bindings',
      });
    }
  } else {
    if (control.parentId) {
      errors.push({
        path: 'parentId',
        message: 'only hitzone controls may have parentId',
      });
    }
    if (control.shape && control.shape !== 'round' && control.shape !== 'rect')
      errors.push({
        path: 'shape',
        message: `unsupported shape ${control.shape}`,
      });
    const hitShape = (control as Control & { hitShape?: string }).hitShape;
    if (hitShape && hitShape !== 'rect')
      errors.push({
        path: 'hitShape',
        message: `unsupported hitShape ${hitShape}`,
      });
  }
  if (control.subLabel !== undefined && control.subLabel !== null) {
    if (typeof control.subLabel !== 'string') {
      errors.push({ path: 'subLabel', message: 'subLabel must be a string' });
    } else if ([...control.subLabel].length > 20) {
      errors.push({
        path: 'subLabel',
        message: 'subLabel must be at most 20 characters',
      });
    } else if (
      control.subLabel !== '' &&
      (control.type === 'label' || control.type === 'hitzone')
    ) {
      errors.push({
        path: 'subLabel',
        message: 'label and hitzone controls cannot have subLabel',
      });
    }
  }
  if (control.type === 'label' && control.binding)
    errors.push({
      path: 'binding',
      message: 'label controls cannot bind input',
    });
  if (control.binding && !knownCommand(control.binding as string))
    errors.push({
      path: 'binding',
      message: `unknown command ${control.binding}`,
    });
  if (
    control.type !== 'hitzone' &&
    control.type !== 'button' &&
    control.type !== 'dpad' &&
    control.type !== 'joystick' &&
    control.type !== 'trigger' &&
    control.type !== 'label'
  ) {
    errors.push({
      path: 'type',
      message: `unsupported control type ${control.type}`,
    });
  }
  if (control.type === 'dpad') {
    if (
      control.bindings?.up !== 'dpadUp' ||
      control.bindings.down !== 'dpadDown' ||
      control.bindings.left !== 'dpadLeft' ||
      control.bindings.right !== 'dpadRight'
    )
      errors.push({
        path: 'bindings',
        message: 'd-pad requires fixed four bindings',
      });
  }
  if (
    control.type === 'joystick' &&
    control.binding !== CommandLeftStick &&
    control.binding !== CommandRightStick
  )
    errors.push({
      path: 'binding',
      message: 'joystick requires leftStick or rightStick',
    });
  if (
    control.type === 'trigger' &&
    control.binding !== CommandLeftTrigger &&
    control.binding !== CommandRightTrigger
  )
    errors.push({
      path: 'binding',
      message: 'trigger requires leftTrigger or rightTrigger',
    });
  return errors;
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
  if (!finitePositive(section.relativeWidth) || section.relativeWidth > 4)
    return false;
  if (section.id !== 'center' && section.relativeMinWidth !== undefined)
    return false;
  if (section.relativeMinWidth !== undefined) {
    if (
      !finitePositive(section.relativeMinWidth) ||
      section.relativeMinWidth > 4
    )
      return false;
  }
  return true;
}

function validControl(control: Control, section: Section): boolean {
  if (getControlErrors(control, section).length > 0) return false;
  return true;
}

function validGeometry(geometry: Geometry, section: Section): boolean {
  if (
    ![geometry.position.x, geometry.position.y].every(
      (value) => Number.isFinite(value) && value >= -2 && value <= 2,
    ) ||
    ![geometry.size.width, geometry.size.height].every(
      (value) => Number.isFinite(value) && value > 0 && value <= 2,
    )
  )
    return false;

  const contentWidth = section.relativeWidth;
  const contentHeight = 1;
  const centerX = contentWidth / 2;
  const centerY = contentHeight / 2;
  // Midpoint check: center must be inside section, edges may overflow.
  const centerPosX = centerX + geometry.position.x;
  const centerPosY = centerY + geometry.position.y;
  const epsilon = 1e-9;
  return (
    centerPosX >= -epsilon &&
    centerPosX <= contentWidth + epsilon &&
    centerPosY >= -epsilon &&
    centerPosY <= contentHeight + epsilon
  );
}

const KNOWN_COMMANDS = new Set<string>([
  CommandSouth,
  CommandEast,
  CommandWest,
  CommandNorth,
  CommandDPadUp,
  CommandDPadDown,
  CommandDPadLeft,
  CommandDPadRight,
  CommandLeftShoulder,
  CommandRightShoulder,
  CommandLeftStick,
  CommandRightStick,
  CommandStart,
  CommandBack,
  CommandGuide,
  CommandLeftTrigger,
  CommandRightTrigger,
]);
function knownCommand(command: string): boolean {
  return KNOWN_COMMANDS.has(command);
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
