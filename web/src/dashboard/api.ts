import type { AdminState, PlayerSnapshot } from '../shared/contracts';

export interface SettingsUpdate {
  bind?: string;
  port?: number;
  advertisedHost?: string;
  advertisedPort?: number;
  defaultLayout?: string;
  gracePeriodSeconds?: number;
  approvalRequired?: boolean;
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

export function getAdminLayout(id: string): Promise<unknown> {
  return request<unknown>(`/api/admin/layouts/${encodeURIComponent(id)}`);
}

export function createAdminLayout(doc: unknown): Promise<unknown> {
  return request<unknown>('/api/admin/layouts', {
    method: 'POST',
    body: JSON.stringify(doc),
  });
}

export function updateAdminLayout(id: string, doc: unknown): Promise<unknown> {
  return request<unknown>(`/api/admin/layouts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(doc),
  });
}

export function deleteAdminLayout(id: string): Promise<AdminState> {
  return request<AdminState>(`/api/admin/layouts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function reloadAdminLayouts(): Promise<AdminState> {
  return request<AdminState>('/api/admin/layouts/reload', { method: 'POST' });
}

export function acceptPublish(
  id: string,
): Promise<{ status: string; id: string }> {
  return request<{ status: string; id: string }>(
    `/api/admin/layouts/publish/${encodeURIComponent(id)}/accept`,
    { method: 'POST' },
  );
}

export function declinePublish(
  id: string,
): Promise<{ status: string; id: string }> {
  return request<{ status: string; id: string }>(
    `/api/admin/layouts/publish/${encodeURIComponent(id)}/decline`,
    { method: 'POST' },
  );
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
    { method: 'POST' },
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

export function setAllPlayerLayouts(layoutId: string): Promise<AdminState> {
  return request<AdminState>('/api/admin/players/layout', {
    method: 'PUT',
    body: JSON.stringify({ layoutId }),
  });
}

export function acceptApproval(id: string): Promise<AdminState> {
  return request<AdminState>(
    `/api/admin/approval/${encodeURIComponent(id)}/accept`,
    { method: 'POST' },
  );
}

export function rejectApproval(
  id: string,
  reason?: string,
): Promise<AdminState> {
  return request<AdminState>(
    `/api/admin/approval/${encodeURIComponent(id)}/reject`,
    {
      method: 'POST',
      body: reason ? JSON.stringify({ reason }) : undefined,
    },
  );
}

export function generateRoomCode(): Promise<AdminState> {
  return request<AdminState>('/api/admin/room-code/generate', {
    method: 'POST',
  });
}

export function setRoomCode(roomCode: string): Promise<AdminState> {
  return request<AdminState>('/api/admin/room-code', {
    method: 'PUT',
    body: JSON.stringify({ roomCode }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
