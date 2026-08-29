import {
  BitBack,
  BitDPadDown,
  BitDPadLeft,
  BitDPadRight,
  BitDPadUp,
  BitEast,
  BitGuide,
  BitLB,
  BitLS,
  BitNorth,
  BitRB,
  BitRS,
  BitSouth,
  BitStart,
  BitWest,
  FrameSize as GeneratedFrameSize,
  Version as GeneratedVersion,
} from './generated/protocol';
import type { LayoutDocument } from './layout';

// Protocol SSOT: Go internal/protocol is canonical, tygo generates ./generated/protocol.ts
export const PROTOCOL_VERSION = GeneratedVersion;
export const FRAME_SIZE = GeneratedFrameSize;

export const ButtonBits = {
  south: BitSouth,
  east: BitEast,
  west: BitWest,
  north: BitNorth,
  dpadUp: BitDPadUp,
  dpadDown: BitDPadDown,
  dpadLeft: BitDPadLeft,
  dpadRight: BitDPadRight,
  leftShoulder: BitLB,
  rightShoulder: BitRB,
  leftStick: BitLS,
  rightStick: BitRS,
  start: BitStart,
  back: BitBack,
  guide: BitGuide,
} as const;

export type { Command } from './generated/protocol';
export type Orientation = 'portrait' | 'landscape';

export type { Config } from './generated/config';
// Re-export generated protocol messages (Go canonical)
export type {
  Capabilities,
  CloseMessage,
  DebugInputTrace,
  Envelope,
  ErrorMessage,
  Hello,
  LayoutMessage,
  LayoutSelect,
  LayoutSummary,
  Ping,
  Pong,
  ResetMessage,
  Rumble,
  Welcome,
} from './generated/protocol';
export type { LayoutDocument };

// Hand-written composite types (not in Go, dashboard-specific)
export type ServerMessage =
  | import('./generated/protocol').Welcome
  | import('./generated/protocol').LayoutMessage
  | import('./generated/protocol').Ping
  | import('./generated/protocol').ErrorMessage
  | import('./generated/protocol').Rumble
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
    gracePeriodSeconds: number;
  };
  layouts: import('./generated/protocol').LayoutSummary[];
  players: PlayerSnapshot[];
}
