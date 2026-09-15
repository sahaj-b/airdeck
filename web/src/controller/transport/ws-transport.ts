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
  private readonly options: WsTransportOptions;

  constructor(options: WsTransportOptions) {
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
    if (socket !== this.socket) return;
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
