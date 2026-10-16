import { describe, expect, it } from 'vitest';
import xboxDefault from '../../layouts/xbox-default.json';
import {
  type RtcDataChannelLike,
  type RtcPeerConnectionLike,
  RtcTransport,
  type RtcTransportOptions,
} from './rtc-transport';
import type { SocketConnection } from './types';

const CAPABILITIES = {
  sound: false,
  wakeLock: false,
  fullscreen: false,
  orientation: false,
};

class FakeSignalingSocket implements SocketConnection {
  readyState = 0;
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(readonly url: string) {}

  send(data: string | Uint8Array): void {
    this.sent.push(String(data));
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  lastSent(): Record<string, unknown> {
    return JSON.parse(this.sent.at(-1) ?? '{}') as Record<string, unknown>;
  }
}

class FakeDataChannel implements RtcDataChannelLike {
  readyState = 'connecting';
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: Array<string | Uint8Array> = [];

  constructor(readonly label: string) {}

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 'closed';
    this.onclose?.();
  }

  open(): void {
    this.readyState = 'open';
    this.onopen?.();
  }

  receive(data: string): void {
    this.onmessage?.({ data });
  }
}

class FakePeerConnection implements RtcPeerConnectionLike {
  iceGatheringState = 'complete';
  onicegatheringstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  channels = new Map<string, FakeDataChannel>();
  localDescription: { sdp?: string } | null = null;
  remoteDescription: { type: string; sdp?: string } | null = null;
  closed = false;

  constructor(readonly config: unknown) {}

  createDataChannel(label: string): FakeDataChannel {
    const channel = new FakeDataChannel(label);
    this.channels.set(label, channel);
    return channel;
  }

  async createOffer(): Promise<{ sdp?: string }> {
    return { sdp: 'fake-offer-sdp' };
  }

  async setLocalDescription(desc: {
    type: string;
    sdp?: string;
  }): Promise<void> {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc: {
    type: string;
    sdp?: string;
  }): Promise<void> {
    this.remoteDescription = desc;
  }

  close(): void {
    this.closed = true;
  }

  drop(): void {
    this.onconnectionstatechange?.();
  }

  channel(label: string): FakeDataChannel {
    const channel = this.channels.get(label);
    if (!channel) throw new Error(`missing data channel ${label}`);
    return channel;
  }
}

interface Harness {
  transport: RtcTransport;
  signals: FakeSignalingSocket[];
  pcs: FakePeerConnection[];
  states: string[];
  errors: Array<{ code: string; message: string }>;
}

function setup(overrides: Partial<RtcTransportOptions> = {}): Harness {
  const signals: FakeSignalingSocket[] = [];
  const pcs: FakePeerConnection[] = [];
  const states: string[] = [];
  const errors: Array<{ code: string; message: string }> = [];
  const transport = new RtcTransport({
    sessionCode: 'ABCD12',
    capabilities: CAPABILITIES,
    relayUrl: 'ws://127.0.0.1:8080/join',
    reconnectDelay: 1,
    signalingSocketFactory: (url) => {
      const socket = new FakeSignalingSocket(url);
      signals.push(socket);
      return socket;
    },
    peerConnectionFactory: (config) => {
      const pc = new FakePeerConnection(config);
      pcs.push(pc);
      return pc;
    },
    onStateChange: (state) => states.push(state),
    onError: (error) =>
      errors.push({ code: error.code, message: error.message }),
    ...overrides,
  });
  return { transport, signals, pcs, states, errors };
}

function welcome(id = 'player-1'): Record<string, unknown> {
  return {
    type: 'welcome',
    playerId: id,
    slot: 0,
    displayName: 'Ada',
    accent: '#6ee7b7',
    reconnectId: 'reconnect-1',
    protocolVersion: 1,
    frameSize: 20,
    targetInputRate: 60,
    selectedLayout: 'xbox-default',
    availableLayouts: [{ id: 'xbox-default', name: 'Xbox default' }],
  };
}

function layoutMessage(): Record<string, unknown> {
  return { type: 'layout', id: 'xbox-default', layout: xboxDefault };
}

const flush = async (rounds = 3): Promise<void> => {
  for (let i = 0; i < rounds; i += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('RtcTransport open mode', () => {
  it('sends join with the offer, closes signaling on answer, and activates after hello', async () => {
    const { transport, signals, pcs, states } = setup();
    transport.connect();
    expect(states).toEqual(['connecting']);

    signals[0].open();
    await flush();
    expect(pcs).toHaveLength(1);
    const pc = pcs[0];
    expect([...pc.channels.keys()].sort()).toEqual(['control', 'inputs']);
    // Room code is normalized before it hits the wire.
    expect(signals[0].lastSent()).toMatchObject({
      type: 'join',
      roomCode: 'ABCD12',
      offer: 'fake-offer-sdp',
    });

    signals[0].receive({
      type: 'joined',
      answer: 'fake-answer-sdp',
      iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
    });
    await flush();
    expect(pc.remoteDescription).toMatchObject({
      type: 'answer',
      sdp: 'fake-answer-sdp',
    });
    // Signaling wss closes once the answer arrives, both modes.
    expect(signals[0].readyState).toBe(3);
    expect(states).toContain('hello-sent');

    const control = pc.channel('control');
    control.open();
    expect(JSON.parse(String(control.sent[0]))).toMatchObject({
      type: 'hello',
      sessionCode: 'ABCD12',
    });

    control.receive(JSON.stringify(welcome()));
    control.receive(JSON.stringify(layoutMessage()));
    expect(states.at(-1)).toBe('active');

    // Inputs ride the unreliable channel with the bufferedAmount drop.
    const inputs = pc.channel('inputs');
    inputs.open();
    expect(transport.sendBinary(new Uint8Array(20))).toBe(true);
    expect(inputs.sent).toHaveLength(1);
    inputs.bufferedAmount = 2049;
    expect(transport.sendBinary(new Uint8Array(20))).toBe(false);
    expect(inputs.sent).toHaveLength(1);
    expect(transport.selectLayout('xbox-default')).toBe(true);
    expect(
      control.sent.some((value) => String(value).includes('layout.select')),
    ).toBe(true);
  });

  it('normalizes folded room codes on the join', async () => {
    const { transport, signals } = setup({ sessionCode: ' ab-cd 12 ' });
    transport.connect();
    signals[0].open();
    await flush();
    expect(signals[0].lastSent()).toMatchObject({
      type: 'join',
      roomCode: 'ABCD12',
    });
  });

  it('maps room_not_found to a rejected join with the generic error', async () => {
    const { transport, signals, states, errors } = setup();
    transport.connect();
    signals[0].open();
    await flush();
    signals[0].receive({
      type: 'error',
      code: 'room_not_found',
      message: 'Room not found or host offline',
    });
    await flush();
    expect(errors).toEqual([
      { code: 'room_not_found', message: 'Room not found or host offline' },
    ]);
    expect(states.at(-1)).toBe('rejected');
    expect(transport.sendBinary(new Uint8Array(20))).toBe(false);
  });

  it('gives up on a silent open-mode host with the dead-code error', async () => {
    const { transport, signals, states, errors } = setup({ joinTimeoutMs: 5 });
    transport.connect();
    signals[0].open();
    await flush();
    // No joined, no error, no pending: the host admitted nothing.
    expect(states).toEqual(['connecting']);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await flush();
    expect(errors).toEqual([
      { code: 'room_not_found', message: 'Room not found or host offline.' },
    ]);
    expect(states.at(-1)).toBe('rejected');
    expect(signals[0].readyState).toBe(3);
  });

  it('gives up on a silent post-accept host without stranding the guest', async () => {
    const { transport, signals, states, errors } = setup({ joinTimeoutMs: 10 });
    transport.connect();
    signals[0].open();
    await flush();
    signals[0].receive({ type: 'pending', pendingId: 'p1' });
    await flush();
    // Waiting on the host parks the timer: no error while queued.
    await new Promise((resolve) => setTimeout(resolve, 30));
    await flush();
    expect(states.at(-1)).toBe('waiting');
    expect(errors).toEqual([]);
    signals[0].receive({
      type: 'accepted',
      iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
    });
    await flush();
    // Accepted re-arms: silence after the post-accept offer rejects.
    await new Promise((resolve) => setTimeout(resolve, 30));
    await flush();
    expect(errors).toEqual([
      { code: 'room_not_found', message: 'Room not found or host offline.' },
    ]);
    expect(states.at(-1)).toBe('rejected');
  });
});

describe('RtcTransport approval mode', () => {
  it('parks on pending, re-offers after accepted, and activates on answer', async () => {
    const { transport, signals, pcs, states } = setup();
    transport.connect();
    signals[0].open();
    await flush();

    signals[0].receive({ type: 'pending', pendingId: 'p1' });
    await flush();
    expect(states).toContain('waiting');
    // The pre-accept PC is discarded; the real offer goes out post-accept.
    expect(pcs[0].closed).toBe(true);

    signals[0].receive({
      type: 'accepted',
      iceServers: [
        {
          urls: ['turn:turn.example:3478'],
          username: 'user',
          credential: 'pass',
        },
      ],
    });
    await flush();
    expect(pcs).toHaveLength(2);
    // Post-accept offer gathers against the accepted bundle.
    expect(
      (pcs[1].config as { iceServers: Array<{ urls: string[] }> }).iceServers,
    ).toEqual([
      {
        urls: ['turn:turn.example:3478'],
        username: 'user',
        credential: 'pass',
      },
    ]);
    expect(signals[0].lastSent()).toMatchObject({
      type: 'offer',
      pendingId: 'p1',
      sdp: 'fake-offer-sdp',
    });

    signals[0].receive({
      type: 'answer',
      correlationId: 'c1',
      sdp: 'final-answer',
    });
    await flush();
    expect(pcs[1].remoteDescription).toMatchObject({ sdp: 'final-answer' });
    expect(signals[0].readyState).toBe(3);

    const control = pcs[1].channel('control');
    control.open();
    control.receive(JSON.stringify(welcome()));
    control.receive(JSON.stringify(layoutMessage()));
    expect(states.at(-1)).toBe('active');
  });

  it('surfaces reject as declined and keeps the join retryable', async () => {
    const { transport, signals, states, errors } = setup();
    transport.connect();
    signals[0].open();
    await flush();
    signals[0].receive({ type: 'pending', pendingId: 'p1' });
    await flush();
    signals[0].receive({ type: 'rejected', reason: 'party is full' });
    await flush();
    expect(errors).toEqual([{ code: 'declined', message: 'party is full' }]);
    expect(states.at(-1)).toBe('declined');
  });

  it('cancel during waiting closes the signaling socket so the pending evaporates', async () => {
    const { transport, signals, states } = setup();
    transport.connect();
    signals[0].open();
    await flush();
    signals[0].receive({ type: 'pending', pendingId: 'p1' });
    await flush();
    expect(states).toContain('waiting');
    transport.close();
    expect(signals[0].readyState).toBe(3);
    expect(transport.state).toBe('closed');
  });
});

describe('RtcTransport reconnect', () => {
  it('rejoins fresh with the stored reconnect id, never an ICE restart', async () => {
    const reconnected: string[] = [];
    const { transport, signals, pcs } = setup({
      onReconnect: () => reconnected.push('reconnect'),
    });
    transport.connect();
    signals[0].open();
    await flush();
    signals[0].receive({
      type: 'joined',
      answer: 'a',
      iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
    });
    await flush();
    const control = pcs[0].channel('control');
    control.open();
    control.receive(JSON.stringify(welcome()));
    control.receive(JSON.stringify(layoutMessage()));
    expect(transport.state).toBe('active');

    // Post-establishment PC loss drops and rejoins with a new offer.
    pcs[0].drop();
    expect(reconnected).toEqual(['reconnect']);
    await flush(10);
    expect(signals.length).toBe(2);
    signals[1].open();
    await flush();
    expect(pcs.length).toBe(2);
    expect(signals[1].lastSent()).toMatchObject({
      type: 'join',
      reconnectId: 'reconnect-1',
      offer: 'fake-offer-sdp',
    });
  });

  it('recovers when the peer dies after the answer but before hello', async () => {
    const reconnected: string[] = [];
    const { transport, signals, pcs, states } = setup({
      onReconnect: () => reconnected.push('reconnect'),
    });
    transport.connect();
    signals[0].open();
    await flush();
    signals[0].receive({
      type: 'joined',
      answer: 'a',
      iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
    });
    await flush();
    expect(states).toContain('hello-sent');
    // DTLS failure with signaling already closed: rejoin, don't strand.
    pcs[0].drop();
    expect(reconnected).toEqual(['reconnect']);
    expect(states.at(-1)).toBe('reconnecting');
    await flush(10);
    expect(signals.length).toBe(2);
  });

  it('maps peer.left to a rejected join', async () => {
    const { transport, signals, states, errors } = setup();
    transport.connect();
    signals[0].open();
    await flush();
    signals[0].receive({ type: 'pending', pendingId: 'p1' });
    await flush();
    signals[0].receive({ type: 'peer.left', pendingId: 'p1' });
    await flush();
    expect(errors).toEqual([
      {
        code: 'peer_left',
        message: 'The host went offline before the join completed.',
      },
    ]);
    expect(states.at(-1)).toBe('rejected');
  });
});
