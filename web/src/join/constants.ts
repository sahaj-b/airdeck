import type { ConnectionState } from '../controller/transport/types';
import { MAX_PLAYERS } from '../shared/contracts';

export const DISPLAY_NAME_KEY = 'airdeck.displayName';
export const SELECTED_LAYOUT_KEY = 'airdeck.selectedLayout';
export const WAKE_LOCK_KEY = 'airdeck.wakeLock';
export const DEFAULT_NAME_PATTERN = /^player(?: \d{1,2})?$/i;

export const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connecting: 'Connecting',
  'hello-sent': 'Joining',
  'welcome-received': 'Loading',
  active: 'Connected',
  waiting: 'Waiting for host approval',
  declined: 'Declined',
  reconnecting: 'Reconnecting',
  rejected: 'Rejected',
  kicked: 'Kicked',
  'session-reset': 'Session reset',
  closed: 'Closed',
};

export const PILL_LABELS: Record<ConnectionState, string> = {
  connecting: 'Connecting',
  'hello-sent': 'Joining',
  'welcome-received': 'Loading',
  active: 'Ready',
  waiting: 'Waiting',
  declined: 'Declined',
  reconnecting: 'Reconnecting',
  rejected: 'Rejected',
  kicked: 'Kicked',
  'session-reset': 'Session reset',
  closed: 'Closed',
};

export const SHORT_STATUS: Record<string, string> = {
  'Controller ready.': 'Ready',
  'The connection to the host closed.': 'Connection closed',
  'Loading layout...': 'Loading layout',
  'The session code is invalid.': 'Invalid code',
  'This session is not accepting new joins.': 'Joins closed',
  [`This session already has ${MAX_PLAYERS} players.`]: 'Session full',
  'The reconnect window has expired. Join as a new player.':
    'Reconnect expired',
  'Room not found or host offline.': 'Room not found',
  // The relay sends the same generic error without the trailing period.
  'Room not found or host offline': 'Room not found',
  'The host declined your join.': 'Declined',
  'The host went offline before the join completed.': 'Host offline',
  'The host could not create your virtual controller.': 'Device error',
  'The host sent an invalid layout. The default layout is being used.':
    'Invalid layout',
};

export const shortStatus = (full: string): string => SHORT_STATUS[full] ?? full;

export const GEAR_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z"/></svg>';

export const SPINNER_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spinner-arc"><circle cx="12" cy="12" r="10" opacity="0.2"/><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
