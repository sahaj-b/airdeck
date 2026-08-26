export const PROTOCOL_VERSION = 1;
export const FRAME_SIZE = 20;
export const TARGET_INPUT_RATE = 60;

import type { LayoutDocument } from './layout';

export type { LayoutDocument };

export const ButtonBits = {
  south: 1 << 0,
  east: 1 << 1,
  west: 1 << 2,
  north: 1 << 3,
  dpadUp: 1 << 4,
  dpadDown: 1 << 5,
  dpadLeft: 1 << 6,
  dpadRight: 1 << 7,
  leftShoulder: 1 << 8,
  rightShoulder: 1 << 9,
  leftStick: 1 << 10,
  rightStick: 1 << 11,
  start: 1 << 12,
  back: 1 << 13,
  guide: 1 << 14,
} as const;

export type Command = keyof typeof ButtonBits | 'leftTrigger' | 'rightTrigger';
export type Orientation = 'portrait' | 'landscape';

export interface Capabilities {
  haptics: boolean;
  sound: boolean;
  wakeLock: boolean;
  fullscreen: boolean;
  orientation: boolean;
}

export interface LayoutSummary {
  id: string;
  name: string;
}
export interface Hello {
  type: 'hello';
  sessionCode: string;
  displayName?: string;
  reconnectId?: string;
  clientVersion: string;
  selectedLayout?: string;
  capabilities: Capabilities;
}
export interface Welcome {
  type: 'welcome';
  playerId: string;
  slot: number;
  displayName: string;
  accent: string;
  reconnectId: string;
  protocolVersion: number;
  frameSize: number;
  targetInputRate: number;
  selectedLayout: string;
  availableLayouts: LayoutSummary[];
}
export interface LayoutMessage {
  type: 'layout';
  id: string;
  layout: LayoutDocument;
}
export interface Ping {
  type: 'ping';
  id: string;
  sent: number;
}
export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}
export interface Rumble {
  type: 'rumble';
  strong: number;
  weak: number;
  active: boolean;
}
export type ServerMessage =
  | Welcome
  | LayoutMessage
  | Ping
  | ErrorMessage
  | Rumble
  | { type: 'close'; reason?: string }
  | { type: 'session.reset' };

export type PlayerState =
  | 'joining'
  | 'active'
  | 'stale'
  | 'disconnected-grace'
  | 'device-error'
  | 'closed';
export interface PlayerSnapshot {
  id: string;
  slot: number;
  name: string;
  fallbackName: string;
  accent: string;
  state: PlayerState;
  layoutId: string;
  generation: number;
  lastInput: string;
  lastPong: string;
  rttNanos: number;
  deviceStatus: string;
  deviceReason?: string;
  rumbleCapable: boolean;
  graceDeadline?: string;
}
export interface AdminState {
  code: string;
  acceptingJoins: boolean;
  advertisedJoinURL: string;
  publicPort: number;
  adminPort: number;
  config: {
    version: number;
    port: number;
    bind: string;
    advertisedHost: string;
    advertisedPort: number;
    defaultLayout: string;
    inputRate: number;
  };
  layouts: LayoutSummary[];
  players: PlayerSnapshot[];
}
