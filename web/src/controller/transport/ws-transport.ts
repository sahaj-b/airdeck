import {
  type ErrorMessage,
  FRAME_SIZE,
  type LayoutMessage,
  type LayoutSummary,
  type LayoutsMessage,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  type PublishResult,
  type ServerMessage,
  type Welcome,
} from '../../shared/contracts';
import { parseLayoutDocument } from '../../shared/layout';

import type {
  ConnectionState,
  ControllerTransport,
  ControllerTransportOptions,
} from './types';

export type { ConnectionState };

export const RECONNECT_ID_KEY = 'airdeck.reconnectId';
export const SELECTED_LAYOUT_KEY = 'airdeck.selectedLayout';

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

export interface ControllerSocketOptions extends ControllerTransportOptions {
  url?: string;
  reconnectDelay?: number;
  socketFactory?: (url: string) => SocketConnection;
}

export class ControllerSocket implements ControllerTransport {
  private socket: SocketConnection | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stateValue: ConnectionState = 'closed';
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private allowReconnect = true;
  private receivedWelcome = false;
  private reconnectId: string | undefined;
  private readonly options: ControllerSocketOptions;

  constructor(options: ControllerSocketOptions) {
    this.options = options;
    this.reconnectId = readSessionValue(RECONNECT_ID_KEY);
  }

  get state(): ConnectionState {
    return this.stateValue;
  }

  connect(): void {
    if (this.stateValue === 'connecting' || this.stateValue === 'hello-sent')
      return;
    this.intentionalClose = false;
    this.allowReconnect = true;
    this.reconnectAttempts = 0;
    this.open();
  }

  sendBinary(frame: Uint8Array): boolean {
    if (this.socket?.readyState !== 1 || this.stateValue !== 'active')
      return false;
    try {
      this.socket.send(frame);
      return true;
    } catch {
      return false;
    }
  }

  selectLayout(id: string): boolean {
    if (this.stateValue !== 'active') return false;
    return this.sendJSON({ type: 'layout.select', id });
  }

  close(reason = 'client_closed'): void {
    this.allowReconnect = false;
    this.intentionalClose = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.socket && this.socket.readyState !== 3) {
      if (this.socket.readyState === 1)
        this.sendJSON({ type: 'close', reason });
      this.socket.close();
    } else {
      this.setState('closed');
    }
  }

  resetReconnectId(): void {
    this.reconnectId = undefined;
    removeSessionValue(RECONNECT_ID_KEY);
  }

  private open(): void {
    this.setState('connecting');
    const socket = this.createSocket();
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => this.handleOpen(socket);
    socket.onmessage = (event) => this.handleMessage(socket, event.data);
    socket.onerror = () => this.options.onError?.(this.connectionError());
    socket.onclose = () => this.handleClose(socket);
  }

  private createSocket(): SocketConnection {
    const url =
      this.options.url ??
      (typeof window === 'undefined' ? '/ws' : websocketURL('/ws'));
    if (this.options.socketFactory) return this.options.socketFactory(url);
    return new WebSocket(url) as unknown as SocketConnection;
  }

  private handleOpen(socket: SocketConnection): void {
    if (socket !== this.socket) return;
    if (this.intentionalClose || !this.allowReconnect) {
      socket.close();
      return;
    }
    this.reconnectAttempts = 0;
    const capabilities =
      typeof this.options.capabilities === 'function'
        ? this.options.capabilities()
        : this.options.capabilities;
    const hello: Record<string, unknown> = {
      type: 'hello',
      sessionCode: this.options.sessionCode,
      clientVersion: this.options.clientVersion ?? 'airdeck-web/1',
      capabilities,
    };
    const displayName = this.options.displayName?.trim();
    const selectedLayout = this.options.selectedLayout?.trim();
    if (displayName) hello.displayName = displayName.slice(0, 40);
    if (selectedLayout) hello.selectedLayout = selectedLayout;
    if (this.reconnectId) hello.reconnectId = this.reconnectId;
    if (!this.sendJSON(hello)) return;
    this.receivedWelcome = false;
    this.setState('hello-sent');
  }

  private handleMessage(socket: SocketConnection, data: unknown): void {
    if (socket !== this.socket || typeof data !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      this.reportError('invalid_message', 'The host sent an invalid message.');
      return;
    }
    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      this.reportError('invalid_message', 'The host sent an invalid message.');
      return;
    }
    // handle publish.result before ServerMessage narrowing (it is not in the hand-written ServerMessage union)
    if (isRecord(parsed) && parsed.type === 'publish.result') {
      const result = parsed as unknown as PublishResult;
      const validStatus = new Set([
        'accepted',
        'declined',
        'expired',
        'cancelled',
      ]);
      if (
        typeof result.id === 'string' &&
        typeof result.status === 'string' &&
        validStatus.has(result.status)
      ) {
        this.options.onPublishResult?.(result);
      } else {
        this.reportError(
          'invalid_message',
          'The host sent an invalid publish result.',
        );
      }
      return;
    }
    const message = parsed as ServerMessage;

    switch (message.type) {
      case 'welcome':
        if (this.receivedWelcome) {
          this.reportError(
            'invalid_message',
            'The host sent a duplicate welcome.',
          );
          return;
        }
        this.handleWelcome(message);
        return;
      case 'layout':
        this.handleLayout(message);
        return;
      case 'layouts':
        this.handleLayouts(message as unknown as LayoutsMessage);
        return;
      case 'slot.update':
        if (
          Number.isInteger(message.slot) &&
          message.slot >= 0 &&
          message.slot < MAX_PLAYERS &&
          typeof message.accent === 'string'
        ) {
          this.options.onSlotUpdate?.(message);
        } else {
          this.reportError(
            'invalid_message',
            'The host sent an invalid slot update.',
          );
        }
        return;
      case 'ping':
        if (typeof message.id === 'string') {
          if (typeof message.rttMs === 'number' && message.rttMs >= 0)
            this.options.onPing?.(message.rttMs);
          this.sendJSON({ type: 'pong', id: message.id });
        } else
          this.reportError(
            'invalid_message',
            'The host sent an invalid heartbeat.',
          );
        return;
      case 'rumble':
        if (
          Number.isInteger(message.strong) &&
          Number.isInteger(message.weak) &&
          typeof message.active === 'boolean'
        ) {
          this.options.onRumble?.(message);
        } else {
          this.reportError(
            'invalid_message',
            'The host sent an invalid rumble message.',
          );
        }
        return;
      case 'error':
        if (
          typeof message.code !== 'string' ||
          typeof message.message !== 'string'
        ) {
          this.reportError(
            'invalid_message',
            'The host sent an invalid error message.',
          );
          return;
        }
        this.handleError(message);
        return;
      case 'close':
        this.intentionalClose = true;
        this.allowReconnect = false;
        if (message.reason === 'kicked' || message.reason === 'kick')
          this.setState('kicked');
        else this.setState('closed');
        this.socket?.close();
        return;
      case 'session.reset':
        this.resetReconnectId();
        this.intentionalClose = true;
        this.allowReconnect = false;
        this.setState('session-reset');
        this.socket?.close();
        return;
      default:
        this.reportError(
          'invalid_message',
          'The host sent an unsupported message.',
        );
    }
  }

  private handleWelcome(message: Welcome): void {
    if (
      message.protocolVersion !== PROTOCOL_VERSION ||
      message.frameSize !== FRAME_SIZE ||
      typeof message.reconnectId !== 'string' ||
      typeof message.playerId !== 'string' ||
      !Number.isInteger(message.slot) ||
      message.slot < 0 ||
      message.slot >= MAX_PLAYERS ||
      !Number.isInteger(message.targetInputRate) ||
      message.targetInputRate < 1 ||
      typeof message.selectedLayout !== 'string' ||
      !Array.isArray(message.availableLayouts)
    ) {
      this.allowReconnect = false;
      this.setState('rejected');
      this.reportError(
        'invalid_welcome',
        'The host sent an invalid controller welcome.',
      );
      this.socket?.close();
      return;
    }
    this.receivedWelcome = true;
    this.reconnectId = message.reconnectId;
    writeSessionValue(RECONNECT_ID_KEY, message.reconnectId);
    this.options.onWelcome?.(message);
    this.setState('welcome-received');
  }

  private handleLayout(message: LayoutMessage): void {
    const resolved = parseLayoutDocument(message.layout);
    this.options.onLayout?.(resolved.layout, resolved.diagnostic);
    if (this.receivedWelcome && this.stateValue === 'welcome-received')
      this.setState('active');
  }

  private handleLayouts(message: LayoutsMessage): void {
    if (!Array.isArray(message.layouts)) {
      this.reportError(
        'invalid_message',
        'The host sent an invalid layouts update.',
      );
      return;
    }
    const layouts: LayoutSummary[] = [];
    for (const entry of message.layouts) {
      if (
        !isRecord(entry) ||
        typeof entry.id !== 'string' ||
        typeof entry.name !== 'string' ||
        !entry.id ||
        entry.id.length > 64
      ) {
        this.reportError(
          'invalid_message',
          'The host sent an invalid layouts update.',
        );
        return;
      }
      layouts.push({ id: entry.id, name: entry.name });
    }
    this.options.onLayouts?.(layouts);
  }

  private handleError(message: ErrorMessage): void {
    this.options.onError?.(message);
    if (
      message.code === 'invalid_reconnect' ||
      message.code === 'invalid_code'
    ) {
      this.resetReconnectId();
    }
    if (!this.receivedWelcome) {
      this.allowReconnect = false;
      this.setState('rejected');
    }
  }

  private handleClose(socket: SocketConnection): void {
    if (socket !== this.socket) return;
    this.socket = undefined;
    if (this.intentionalClose || !this.allowReconnect) {
      if (
        this.stateValue !== 'kicked' &&
        this.stateValue !== 'session-reset' &&
        this.stateValue !== 'rejected'
      )
        this.setState('closed');
      this.options.onClose?.();
      return;
    }
    this.options.onReconnect?.();
    this.setState('reconnecting');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.allowReconnect) return;
    const baseDelay = this.options.reconnectDelay ?? 250;
    const delay = Math.min(baseDelay * 2 ** this.reconnectAttempts, 2000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.open();
    }, delay);
  }

  sendJSON(message: object): boolean {
    if (this.socket?.readyState !== 1) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  private setState(state: ConnectionState): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    this.options.onStateChange?.(state);
  }

  private connectionError(): ErrorMessage {
    return {
      type: 'error',
      code: 'connection_error',
      message: 'The connection to the host was interrupted.',
    };
  }

  private reportError(code: string, message: string): void {
    this.options.onError?.({ type: 'error', code, message });
  }
}

export function websocketURL(path: string): string {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readSessionValue(key: string): string | undefined {
  try {
    return sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeSessionValue(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Private browsing storage failures do not prevent a fresh join.
  }
}

function removeSessionValue(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Private browsing storage failures do not prevent the reset flow.
  }
}

// WsTransport is the LAN WebSocket implementation of ControllerTransport.
// It is the same class as ControllerSocket under its transport name;
// ControllerSocket stays as the backwards-compatible alias.
export { ControllerSocket as WsTransport };
