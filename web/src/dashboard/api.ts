import type { AdminState, PlayerSnapshot } from '../shared/contracts';

export interface ResourceSample {
  at: string;
  players: number;
  goroutines: number;
  memoryBytes: number;
  fileDescriptors: number;
  userCpuTime: number;
  systemCpuTime: number;
}

// DiagnosticsResponse is the shape served by /api/admin/diagnostics: the
// metrics summary plus the sampled frame trace used by lanbench.
export interface DiagnosticsResponse {
  summary: DiagnosticsSummary;
  trace: unknown[];
}

export interface DiagnosticsSummary {
  acceptedFrames: number;
  rejectedFrames: number;
  staleFrames: number;
  watchdogCount: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  watchdogP50: number;
  watchdogP95: number;
  watchdogMax: number;
  resources: ResourceSample[];
}

export interface SettingsUpdate {
  bind?: string;
  port?: number;
  advertisedHost?: string;
  advertisedPort?: number;
  defaultLayout?: string;
}

export interface AdminEvent {
  type: string;
  player?: PlayerSnapshot;
  message?: string;
  state: AdminState;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === 'string'
        ? payload.error
        : `Request failed with status ${response.status}.`;
    throw new Error(message);
  }
  return payload as T;
}

export function getAdminState(): Promise<AdminState> {
  return request<AdminState>('/api/admin/state');
}

export async function getDiagnostics(): Promise<DiagnosticsSummary> {
  const response = await request<DiagnosticsResponse>('/api/admin/diagnostics');
  return response.summary;
}

export function newSession(): Promise<AdminState> {
  return request<AdminState>('/api/admin/session/new', { method: 'POST' });
}

export function setJoins(acceptingJoins: boolean): Promise<AdminState> {
  return request<AdminState>('/api/admin/joins', {
    method: 'PUT',
    body: JSON.stringify({ acceptingJoins }),
  });
}

export function updateSettings(update: SettingsUpdate): Promise<AdminState> {
  return request<AdminState>('/api/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(update),
  });
}

export function kickPlayer(id: string): Promise<AdminState> {
  return request<AdminState>(
    `/api/admin/players/${encodeURIComponent(id)}/kick`,
    {
      method: 'POST',
    },
  );
}

export function movePlayer(id: string, slot: number): Promise<AdminState> {
  return request<AdminState>(
    `/api/admin/players/${encodeURIComponent(id)}/move`,
    {
      method: 'POST',
      body: JSON.stringify({ slot }),
    },
  );
}

export function setPlayerLayout(
  id: string,
  layoutId: string,
): Promise<AdminState> {
  return request<AdminState>(
    `/api/admin/players/${encodeURIComponent(id)}/layout`,
    {
      method: 'PUT',
      body: JSON.stringify({ layoutId }),
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
