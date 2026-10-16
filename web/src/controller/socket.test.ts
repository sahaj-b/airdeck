import { describe, expect, it } from 'vitest';
import xboxDefault from '../layouts/xbox-default.json';
import { MAX_PLAYERS } from '../shared/contracts';
import type { SocketConnection } from './transport/types';
import { WsTransport } from './transport/ws-transport';

class FakeSocket implements SocketConnection {
  readyState = 0;
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: Array<string | Uint8Array> = [];

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  message(data: string): void {
    this.onmessage?.({ data });
  }
}

describe('WsTransport', () => {
  it('sends hello, answers heartbeat, and activates after a valid layout', () => {
    const fake = new FakeSocket();
    const states: string[] = [];
    const socket = new WsTransport({
      sessionCode: '4821',
      displayName: 'Ada',
      capabilities: {
        sound: false,
        wakeLock: false,
        fullscreen: false,
        orientation: false,
      },
      socketFactory: () => fake,
      onStateChange: (state) => states.push(state),
    });

    socket.connect();
    fake.open();
    expect(JSON.parse(String(fake.sent[0]))).toMatchObject({
      type: 'hello',
      sessionCode: '4821',
      displayName: 'Ada',
    });
    fake.message(
      JSON.stringify({
        type: 'welcome',
        playerId: 'player',
        slot: 0,
        displayName: 'Ada',
        accent: '#6ee7b7',
        reconnectId: 'reconnect',
        protocolVersion: 1,
        frameSize: 20,
        targetInputRate: 60,
        selectedLayout: 'xbox-default',
        availableLayouts: [{ id: 'xbox-default', name: 'Xbox default' }],
      }),
    );
    fake.message(JSON.stringify({ type: 'ping', id: 'ping-1', sent: 1 }));
    fake.message(
      JSON.stringify({
        type: 'layout',
        id: 'xbox-default',
        layout: xboxDefault,
      }),
    );

    expect(states).toEqual([
      'connecting',
      'hello-sent',
      'welcome-received',
      'active',
    ]);
    expect(fake.sent.some((value) => String(value).includes('ping-1'))).toBe(
      true,
    );
    expect(socket.sendBinary(new Uint8Array(20))).toBe(true);
  });

  it('reports heartbeat RTT and still replies with a pong', () => {
    const fake = new FakeSocket();
    const pings: number[] = [];
    new WsTransport({
      sessionCode: '4821',
      capabilities: {
        sound: false,
        wakeLock: false,
        fullscreen: false,
        orientation: false,
      },
      socketFactory: () => fake,
      onPing: (rttMs) => pings.push(rttMs),
    }).connect();
    fake.open();
    fake.message(
      JSON.stringify({ type: 'ping', id: 'ping-1', sent: 1, rttMs: 12 }),
    );

    expect(pings).toEqual([12]);
    expect(fake.sent.some((value) => String(value).includes('"pong"'))).toBe(
      true,
    );
  });

  it('applies host slot updates and reports malformed ones without closing', () => {
    const fake = new FakeSocket();
    const updates: Array<{ slot: number; accent: string }> = [];
    const errors: string[] = [];
    const socket = new WsTransport({
      sessionCode: '4821',
      capabilities: {
        sound: false,
        wakeLock: false,
        fullscreen: false,
        orientation: false,
      },
      socketFactory: () => fake,
      onSlotUpdate: (update) =>
        updates.push({ slot: update.slot, accent: update.accent }),
      onError: (error) => errors.push(error.code),
    });
    socket.connect();
    fake.open();
    fake.message(
      JSON.stringify({ type: 'slot.update', slot: 3, accent: '#fbbf24' }),
    );
    expect(updates).toEqual([{ slot: 3, accent: '#fbbf24' }]);
    fake.message(
      JSON.stringify({ type: 'slot.update', slot: 99, accent: '#fbbf24' }),
    );
    expect(updates).toEqual([{ slot: 3, accent: '#fbbf24' }]);
    expect(errors).toEqual(['invalid_message']);
    expect(socket.state).toBe('hello-sent');
  });

  it('applies host layouts updates and reports malformed ones', () => {
    const fake = new FakeSocket();
    const seen: Array<Array<{ id: string; name: string }>> = [];
    const errors: string[] = [];
    new WsTransport({
      sessionCode: '4821',
      capabilities: {
        sound: false,
        wakeLock: false,
        fullscreen: false,
        orientation: false,
      },
      socketFactory: () => fake,
      onLayouts: (layouts) => seen.push(layouts),
      onError: (error) => errors.push(error.code),
    }).connect();
    fake.open();
    fake.message(
      JSON.stringify({
        type: 'layouts',
        layouts: [
          { id: 'xbox-default', name: 'Xbox default' },
          { id: 'my-publish', name: 'My publish' },
        ],
      }),
    );
    expect(seen).toEqual([
      [
        { id: 'xbox-default', name: 'Xbox default' },
        { id: 'my-publish', name: 'My publish' },
      ],
    ]);
    fake.message(JSON.stringify({ type: 'layouts', layouts: [{ id: '' }] }));
    expect(seen.length).toBe(1);
    expect(errors).toEqual(['invalid_message']);
  });

  it('lands on closed when close() runs on a live socket', () => {
    const fake = new FakeSocket();
    const states: string[] = [];
    let closes = 0;
    const socket = new WsTransport({
      sessionCode: '4821',
      capabilities: {
        sound: false,
        wakeLock: false,
        fullscreen: false,
        orientation: false,
      },
      socketFactory: () => fake,
      onStateChange: (state) => states.push(state),
      onClose: () => {
        closes += 1;
      },
    });
    socket.connect();
    fake.open();
    expect(socket.state).toBe('hello-sent');
    socket.close('test');
    // The socket's own onclose must not report or transition a second time.
    expect(socket.state).toBe('closed');
    expect(states.at(-1)).toBe('closed');
    expect(closes).toBe(1);
    socket.close('again');
    expect(closes).toBe(1);
  });

  it('rejects the connection after a pre-welcome admission error', () => {
    const fake = new FakeSocket();
    const states: string[] = [];
    const socket = new WsTransport({
      sessionCode: '0000',
      capabilities: {
        sound: false,
        wakeLock: false,
        fullscreen: false,
        orientation: false,
      },
      socketFactory: () => fake,
      onStateChange: (state) => states.push(state),
    });
    socket.connect();
    fake.open();
    fake.message(
      JSON.stringify({
        type: 'error',
        code: 'session_full',
        message: `This session already has ${MAX_PLAYERS} players.`,
      }),
    );
    expect(socket.state).toBe('rejected');
    expect(states.at(-1)).toBe('rejected');
    expect(socket.sendBinary(new Uint8Array(20))).toBe(false);
  });
});
