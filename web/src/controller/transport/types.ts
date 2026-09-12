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

// ConnectionState is the player-visible lifecycle shared by both
// transports. The WS path never emits waiting/declined; the RTC path
// enters waiting while an approval-mode join sits in the host queue and
// declined when the host rejects it.
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

// ControllerTransport is the phone-side seam abstracting the wire
// (LORE). WsTransport wraps the LAN WebSocket, RtcTransport wraps the
// reliable control plus unreliable inputs DataChannel pair. Session logic
// above it (FrameSender, join page) never knows which wire it rides.
export interface ControllerTransport {
  readonly state: ConnectionState;
  connect(): void;
  sendBinary(frame: Uint8Array): boolean;
  sendJSON(message: object): boolean;
  selectLayout(id: string): boolean;
  close(): void;
  resetReconnectId(): void;
}
