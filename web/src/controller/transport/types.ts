import type {
  Capabilities,
  ErrorMessage,
  LayoutSummary,
  PublishResult,
  Rumble,
  SlotUpdate,
  Welcome,
} from '../../shared/contracts';
import type { LayoutDocument } from '../../shared/layout';

// ConnectionState is the player-visible lifecycle shared by both transports.
export type ConnectionState =
  | 'connecting'
  | 'hello-sent'
  | 'welcome-received'
  | 'active'
  | 'waiting'
  | 'declined'
  | 'reconnecting'
  | 'rejected'
  | 'kicked'
  | 'session-reset'
  | 'closed';

// RECONNECT_ID_KEY persists the session-scoped reclaim id across reloads.
export const RECONNECT_ID_KEY = 'airdeck.reconnectId';

export interface SocketConnection {
  readyState: number;
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string | Uint8Array): void;
  close(): void;
}

export interface ControllerTransportOptions {
  sessionCode: string;
  displayName?: string;
  clientVersion?: string;
  selectedLayout?: string;
  capabilities: Capabilities | (() => Capabilities);
  onStateChange?: (state: ConnectionState) => void;
  onWelcome?: (welcome: Welcome) => void;
  onLayout?: (layout: LayoutDocument, diagnostic?: string) => void;
  onLayouts?: (layouts: LayoutSummary[]) => void;
  onSlotUpdate?: (update: SlotUpdate) => void;
  onError?: (error: ErrorMessage) => void;
  onRumble?: (rumble: Rumble) => void;
  onPing?: (rttMs: number) => void;
  onPublishResult?: (result: PublishResult) => void;
  onReconnect?: () => void;
  onClose?: () => void;
}

// ControllerTransport abstracts the wire; session logic never knows which
// transport it rides.
export interface ControllerTransport {
  readonly state: ConnectionState;
  connect(): void;
  sendBinary(frame: Uint8Array): boolean;
  sendJSON(message: object): boolean;
  selectLayout(id: string): boolean;
  close(): void;
  resetReconnectId(): void;
}
