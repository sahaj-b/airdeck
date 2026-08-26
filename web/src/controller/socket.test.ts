import { describe, expect, it } from 'vitest';
import xboxDefault from '../layouts/xbox-default.json';
import { ControllerSocket, type SocketConnection } from './socket';

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

describe('ControllerSocket', () => {
  it('sends hello, answers heartbeat, and activates after a valid layout', () => {
    const fake = new FakeSocket();
    const states: string[] = [];
    const socket = new ControllerSocket({
      sessionCode: '4821',
      displayName: 'Ada',
      capabilities: {
        haptics: false,
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
    new ControllerSocket({
      sessionCode: '4821',
      capabilities: {
        haptics: false,
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

  it('rejects the connection after a pre-welcome admission error', () => {
    const fake = new FakeSocket();
    const states: string[] = [];
    const socket = new ControllerSocket({
      sessionCode: '0000',
      capabilities: {
        haptics: false,
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
        message: 'This session already has 16 players.',
      }),
    );
    expect(socket.state).toBe('rejected');
    expect(states.at(-1)).toBe('rejected');
    expect(socket.sendBinary(new Uint8Array(20))).toBe(false);
  });
});
