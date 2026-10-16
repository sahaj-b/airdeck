import type {
  ErrorMessage,
  LayoutMessage,
  LayoutsMessage,
  Welcome,
} from '../../shared/contracts';
import { parseLayoutDocument } from '../../shared/layout';
import {
  dispatchControlMessage,
  isValidLayouts,
  isValidWelcome,
  parseControlFrame,
  readSessionValue,
  removeSessionValue,
  writeSessionValue,
} from './guards';
import {
  type ConnectionState,
  type ControllerTransport,
  type ControllerTransportOptions,
  RECONNECT_ID_KEY,
  type SocketConnection,
  type TransportDebugStats,
} from './types';

export { RECONNECT_ID_KEY } from './types';
export type { ConnectionState, SocketConnection };

export interface WsTransportOptions extends ControllerTransportOptions {
  url?: string;
  reconnectDelay?: number;
  socketFactory?: (url: string) => SocketConnection;
}

export class WsTransport implements ControllerTransport {
  private socket: SocketConnection | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stateValue: ConnectionState = 'closed';
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private allowReconnect = true;
  private receivedWelcome = false;
  private reconnectId: string | undefined;
  private inputsSent = 0;
  private readonly options: WsTransportOptions;

  constructor(options: WsTransportOptions) {
    this.options = options;
    this.reconnectId = readSessionValue(RECONNECT_ID_KEY);
  }

  get state(): ConnectionState {
    return this.stateValue;
  }

  connect(): void {
    if (
      this.stateValue === 'connecting' ||
      this.stateValue === 'hello-sent' ||
      this.stateValue === 'waiting' ||
      this.stateValue === 'reconnecting' ||
      this.stateValue === 'active' ||
      this.stateValue === 'welcome-received'
    )
      return;
    this.intentionalClose = false;
    this.allowReconnect = true;
    this.reconnectAttempts = 0;
    this.closeSocket();
    this.open();
  }

  sendBinary(frame: Uint8Array): boolean {
    if (this.socket?.readyState !== 1 || this.stateValue !== 'active')
      return false;
    try {
      this.socket.send(frame);
      this.inputsSent += 1;
      return true;
    } catch {
      return false;
    }
  }

  // Read-only counters for joystick experiments. The LAN send path itself
  // is untouched: still no drop, still direct socket.send.
  getDebugStats(): TransportDebugStats {
    const socket = this.socket as unknown as
      | { bufferedAmount?: number }
      | undefined;
    return {
      sent: this.inputsSent,
      dropped: 0,
      buffered:
        typeof socket?.bufferedAmount === 'number' ? socket.bufferedAmount : 0,
    };
  }

  selectLayout(id: string): boolean {
    if (this.stateValue !== 'active') return false;
    return this.sendJSON({ type: 'layout.select', id });
  }

  close(reason = 'client_closed'): void {
    const alreadyClosed = this.stateValue === 'closed' && !this.socket;
    this.allowReconnect = false;
    this.intentionalClose = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const socket = this.socket;
    if (socket && socket.readyState !== 3) {
      if (socket.readyState === 1) this.sendJSON({ type: 'close', reason });
      // Clear before close so the async onclose is a no-op (RTC parity:
      // close() fires onClose synchronously, exactly once).
      this.socket = undefined;
      try {
        socket.close();
      } catch {
        // Teardown never blocks input.
      }
    } else {
      this.socket = undefined;
    }
    // RTC parity: close() always lands on 'closed'; the cleared socket
    // makes the async onclose a no-op, so nothing else sets it.
    if (this.stateValue !== 'closed') this.setState('closed');
    if (!alreadyClosed) this.options.onClose?.();
  }

  resetReconnectId(): void {
    this.reconnectId = undefined;
    removeSessionValue(RECONNECT_ID_KEY);
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = undefined;
    try {
      socket?.close();
    } catch {
      // Teardown never blocks input.
    }
  }

  private open(): void {
    this.setState('connecting');
    // Close any predecessor: re-entrant connect() must not orphan a socket.
    this.closeSocket();
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
    if (socket !== this.socket) return;
    // RTC parity: non-string frames are silently ignored (old socket.ts
    // also ignored them). Only a string that fails JSON parse surfaces
    // invalid_message, so a future binary use or middlebox artifact does
    // not show a user-visible error on LAN while RTC stays silent.
    if (typeof data !== 'string') return;
    const parsed = parseControlFrame(data);
    if (parsed === undefined) {
      this.reportError('invalid_message', 'The host sent an invalid message.');
      return;
    }
    dispatchControlMessage(parsed, {
      onWelcome: (message) => {
        if (this.receivedWelcome) {
          this.reportError(
            'invalid_message',
            'The host sent a duplicate welcome.',
          );
          return;
        }
        this.handleWelcome(message);
      },
      onLayout: (message) => this.handleLayout(message),
      onLayouts: (message) => this.handleLayouts(message),
      onSlotUpdate: (slot, accent) =>
        this.options.onSlotUpdate?.({ type: 'slot.update', slot, accent }),
      onPing: (id, rttMs) => {
        if (rttMs !== undefined) this.options.onPing?.(rttMs);
        this.sendJSON({ type: 'pong', id });
      },
      onRumble: (strong, weak, active) =>
        this.options.onRumble?.({ type: 'rumble', strong, weak, active }),
      onControlError: (code, message) =>
        this.handleError({ type: 'error', code, message }),
      onClose: (reason) => {
        this.intentionalClose = true;
        this.allowReconnect = false;
        if (reason === 'kicked' || reason === 'kick') this.setState('kicked');
        else this.setState('closed');
        this.socket?.close();
      },
      onSessionReset: () => {
        this.resetReconnectId();
        this.intentionalClose = true;
        this.allowReconnect = false;
        this.setState('session-reset');
        this.socket?.close();
      },
      onPublishResult: (id, status) =>
        this.options.onPublishResult?.({
          type: 'publish.result',
          id,
          status: status as 'accepted' | 'declined' | 'expired' | 'cancelled',
        }),
      reportError: (code, message) => this.reportError(code, message),
    });
  }

  private handleWelcome(message: Welcome): void {
    if (!isValidWelcome(message)) {
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
    const layouts = isValidLayouts(message);
    if (layouts === undefined) {
      this.reportError(
        'invalid_message',
        'The host sent an invalid layouts update.',
      );
      return;
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
