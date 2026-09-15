import {
  FRAME_SIZE,
  type LayoutMessage,
  type LayoutSummary,
  type LayoutsMessage,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  type ServerMessage,
  type Welcome,
} from '../../shared/contracts';

const VALID_PUBLISH_STATUS: ReadonlySet<string> = new Set([
  'accepted',
  'declined',
  'expired',
  'cancelled',
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readSessionValue(key: string): string | undefined {
  try {
    return sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeSessionValue(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Private browsing storage failures do not prevent a fresh join.
  }
}

export function removeSessionValue(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Private browsing storage failures do not prevent the reset flow.
  }
}

// ControlProtocolCallbacks owns the receive side both transports share:
// parse one host JSON frame and dispatch to the matching callback.
// Transports keep only wire send plus teardown. This is the single
// validator for the JSON protocol.
export interface ControlProtocolCallbacks {
  onWelcome: (message: Welcome) => void;
  onLayout: (message: LayoutMessage) => void;
  onLayouts: (message: LayoutsMessage) => void;
  onSlotUpdate: (slot: number, accent: string) => void;
  onPing: (id: string, rttMs?: number) => void;
  onRumble: (strong: number, weak: number, active: boolean) => void;
  onControlError: (code: string, message: string) => void;
  onClose: (reason?: string) => void;
  onSessionReset: () => void;
  onPublishResult: (id: string, status: string) => void;
  reportError: (code: string, message: string) => void;
}

export function dispatchControlMessage(
  parsed: unknown,
  cb: ControlProtocolCallbacks,
): void {
  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    cb.reportError('invalid_message', 'The host sent an invalid message.');
    return;
  }
  const message = parsed as unknown as ServerMessage;
  switch (message.type) {
    case 'welcome':
      cb.onWelcome(message);
      return;
    case 'layout':
      cb.onLayout(message);
      return;
    case 'layouts':
      cb.onLayouts(message);
      return;
    case 'slot.update':
      if (
        Number.isInteger(message.slot) &&
        message.slot >= 0 &&
        message.slot < MAX_PLAYERS &&
        typeof message.accent === 'string'
      ) {
        cb.onSlotUpdate(message.slot, message.accent);
      } else {
        cb.reportError(
          'invalid_message',
          'The host sent an invalid slot update.',
        );
      }
      return;
    case 'ping':
      if (typeof message.id === 'string') {
        cb.onPing(
          message.id,
          typeof message.rttMs === 'number' && message.rttMs >= 0
            ? message.rttMs
            : undefined,
        );
      } else {
        cb.reportError(
          'invalid_message',
          'The host sent an invalid heartbeat.',
        );
      }
      return;
    case 'rumble':
      if (
        Number.isInteger(message.strong) &&
        Number.isInteger(message.weak) &&
        typeof message.active === 'boolean'
      ) {
        cb.onRumble(message.strong, message.weak, message.active);
      } else {
        cb.reportError(
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
        cb.reportError(
          'invalid_message',
          'The host sent an invalid error message.',
        );
        return;
      }
      cb.onControlError(message.code, message.message);
      return;
    case 'close':
      cb.onClose(message.reason);
      return;
    case 'session.reset':
      cb.onSessionReset();
      return;
    case 'publish.result':
      if (typeof message.id === 'string' && isPublishStatus(message.status)) {
        cb.onPublishResult(message.id, message.status);
      } else {
        cb.reportError(
          'invalid_message',
          'The host sent an invalid publish result.',
        );
      }
      return;
    default:
      cb.reportError(
        'invalid_message',
        'The host sent an unsupported message.',
      );
  }
}

export function parseControlFrame(data: unknown): unknown | undefined {
  if (typeof data !== 'string') return undefined;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return undefined;
  }
}

export function isValidLayouts(
  message: LayoutsMessage,
): { id: string; name: string }[] | undefined {
  if (!Array.isArray(message.layouts)) return undefined;
  const layouts: LayoutSummary[] = [];
  for (const entry of message.layouts) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      typeof entry.name !== 'string' ||
      !entry.id ||
      entry.id.length > 64
    ) {
      return undefined;
    }
    layouts.push({ id: entry.id, name: entry.name });
  }
  return layouts;
}

export function isValidWelcome(message: Welcome): boolean {
  return (
    message.protocolVersion === PROTOCOL_VERSION &&
    message.frameSize === FRAME_SIZE &&
    typeof message.reconnectId === 'string' &&
    typeof message.playerId === 'string' &&
    Number.isInteger(message.slot) &&
    message.slot >= 0 &&
    message.slot < MAX_PLAYERS &&
    Number.isInteger(message.targetInputRate) &&
    message.targetInputRate >= 1 &&
    typeof message.selectedLayout === 'string' &&
    Array.isArray(message.availableLayouts)
  );
}
function isPublishStatus(status: unknown): boolean {
  return typeof status === 'string' && VALID_PUBLISH_STATUS.has(status);
}
