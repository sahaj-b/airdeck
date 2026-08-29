import { useSyncExternalStore } from 'react';
import type { AdminState } from '../shared/contracts';
import {
  type AdminEvent,
  getAdminState,
  kickPlayer,
  movePlayer,
  newSession,
  type SettingsUpdate,
  setAllPlayerLayouts,
  setJoins,
  setPlayerLayout,
  updateSettings,
} from './api';

export interface AdminSnapshot {
  state: AdminState | null;
  loading: boolean;
  connected: boolean;
  error: string | null;
}

export class AdminStore {
  private snapshot: AdminSnapshot = {
    state: null,
    loading: true,
    connected: false,
    error: null,
  };
  private readonly listeners = new Set<() => void>();
  private socket: WebSocket | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AdminSnapshot => this.snapshot;

  async load(): Promise<void> {
    this.setSnapshot({ loading: true, error: null });
    try {
      const state = await getAdminState();
      this.setSnapshot({ state, loading: false, error: null });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to load dashboard state.';
      this.setSnapshot({ loading: false, error: message });
    }
  }

  connect(): void {
    if (this.socket) return;
    this.stopped = false;
    const url = new URL('/api/admin/ws', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => this.setSnapshot({ connected: true, error: null });
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onerror = () =>
      this.setSnapshot({ error: 'The dashboard connection failed.' });
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.setSnapshot({ connected: false });
      this.scheduleReconnect();
    };
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket?.close();
    this.socket = undefined;
    this.setSnapshot({ connected: false });
  }

  async startNewSession(): Promise<void> {
    await this.runAction(newSession());
  }

  async setAcceptingJoins(value: boolean): Promise<void> {
    await this.runAction(setJoins(value));
  }

  async saveSettings(update: SettingsUpdate): Promise<void> {
    try {
      this.setSnapshot({ error: null });
      this.setSnapshot({ state: await updateSettings(update) });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'The host rejected that action.';
      this.setSnapshot({ error: message });
      throw error;
    }
    const state = this.snapshot.state;
    if (state) {
      const currentPort = window.location.port;
      const targetPort = String(state.adminPort);
      if (targetPort && targetPort !== currentPort) {
        const url = new URL(window.location.href);
        url.port = targetPort;
        window.location.href = url.toString();
      }
    }
  }

  async kick(id: string): Promise<void> {
    await this.runAction(kickPlayer(id));
  }

  async move(id: string, slot: number): Promise<void> {
    await this.runAction(movePlayer(id, slot));
  }

  async setLayout(id: string, layoutId: string): Promise<void> {
    await this.runAction(setPlayerLayout(id, layoutId));
  }

  async setAllLayouts(layoutId: string): Promise<void> {
    await this.runAction(setAllPlayerLayouts(layoutId));
  }

  private async runAction(action: Promise<AdminState>): Promise<void> {
    try {
      this.setSnapshot({ error: null });
      this.setSnapshot({ state: await action });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'The host rejected that action.';
      this.setSnapshot({ error: message });
      throw error;
    }
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    try {
      const message: unknown = JSON.parse(data);
      if (isAdminState(message)) {
        this.setSnapshot({ state: message, loading: false });
      } else if (isAdminEvent(message)) {
        this.setSnapshot({ state: message.state, loading: false });
      }
    } catch {
      this.setSnapshot({ error: 'The host sent an invalid dashboard update.' });
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== undefined) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, 1000);
  }

  private setSnapshot(update: Partial<AdminSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener();
  }
}

export function useAdminSnapshot(store: AdminStore): AdminSnapshot {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

function isAdminState(value: unknown): value is AdminState {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    typeof value.acceptingJoins === 'boolean' &&
    Array.isArray(value.players) &&
    Array.isArray(value.layouts)
  );
}

function isAdminEvent(value: unknown): value is AdminEvent {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    isAdminState(value.state)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
