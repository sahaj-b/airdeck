function readDebugFlag(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === '1') return true;
    return localStorage.getItem('airdeck.debug') === '1';
  } catch {
    return false;
  }
}

// CONTROLLER_DEBUG enables client-side join logging for one session:
// ?debug=1 (or localStorage airdeck.debug=1) prints transport pick, state
// transitions, welcome/layout receipts, and DataChannel/SDP milestones to
// the console. Off by default; safe to leave in prod since it only logs.
export const CONTROLLER_DEBUG: boolean = readDebugFlag();

export function debugLog(...args: unknown[]): void {
  if (CONTROLLER_DEBUG) {
    // eslint-disable-next-line no-console
    console.log('[airdeck]', ...args);
  }
}
