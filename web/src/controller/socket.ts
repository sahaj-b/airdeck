// Backwards-compatible re-export: the LAN socket moved to
// transport/ws-transport.ts as part of the ControllerTransport seam
// (PLAN Phase 6). Existing imports keep working.
export * from './transport/ws-transport';
