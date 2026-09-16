import { normalizeRoomCode } from '../../join/storage';
import type {
  ICEServer,
  LayoutMessage,
  LayoutsMessage,
  Welcome,
} from '../../shared/contracts';
import { parseLayoutDocument } from '../../shared/layout';
import { CONTROLLER_DEBUG, debugLog } from '../debug';
import {
  dispatchControlMessage,
  isRecord,
  isValidLayouts,
  isValidWelcome,
  readSessionValue,
  removeSessionValue,
  writeSessionValue,
} from './guards';
import type {
  ConnectionState,
  ControllerTransport,
  ControllerTransportOptions,
  SocketConnection,
} from './types';
import { RECONNECT_ID_KEY } from './types';

// Production relay join socket.
export const PROD_RELAY_JOIN_URL = 'wss://signal.airdeck.sahaj.dev/join';

const FALLBACK_ICE_SERVERS: ICEServer[] = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
];

const CONTROL_LABEL = 'control';
const INPUTS_LABEL = 'inputs';
const DATA_CHANNEL_PROTOCOL = 'airdeck-v1';
// Mirrors the drop rule the host enforces: frames queueing past this
// on the unreliable channel are dropped, never backpressured into input.
const MAX_BUFFERED_BYTES = 1024;
// Bounds ICE gathering like the host gatherTimeout so a dead STUN server
// cannot stall the join: the offer goes out with host candidates.
const GATHER_TIMEOUT_MS = 5000;
// Bounds one open-mode join attempt: the relay has no host-to-guest error
// path for open flows (see handleRelayJoin), so a host that admits nothing
// answers nothing and the guest would sit in connecting forever. Firing
// first means the phone gives up on its own and shows the dead-code error
// instead of hanging. Approval-mode guests never trip it: they get pending
// or an error while the timer is parked.
const JOIN_TIMEOUT_MS = 15000;

// relayJoinURL resolves the signaling socket URL: explicit ?relay= wins
// (LAN drills through Caddy), loopback pages map to the local relay
// default :8080, everything else uses the production relay.
export function relayJoinURL(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const override = params.get('relay')?.trim();
    if (override) return override;
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1')
      return 'ws://127.0.0.1:8080/join';
  } catch {
    // Non-browser contexts (tests) fall through to production.
  }
  return PROD_RELAY_JOIN_URL;
}

// isTurnOnly forces relay-only candidates so the TURN path is
// reproducible on demand. Mirrors the host AIRDECK_TURN_ONLY env.
export function isTurnOnly(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('turnonly') === '1') return true;
    return localStorage.getItem('airdeck.turnOnly') === '1';
  } catch {
    return false;
  }
}

// Minimal structural surface of RTCPeerConnection used by the transport.
// Production passes the real class through the factory cast once; tests
// inject fakes. Deliberately narrow so fakes stay small.
export interface RtcDataChannelLike {
  readonly label: string;
  readonly readyState: string;
  readonly bufferedAmount: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  send(data: string | Uint8Array): void;
  close(): void;
}

export interface RtcPeerConnectionLike {
  readonly iceGatheringState: string;
  readonly connectionState?: string;
  onicegatheringstatechange: (() => void) | null;
  onconnectionstatechange: (() => void) | null;
  createDataChannel(
    label: string,
    init?: { ordered?: boolean; maxRetransmits?: number; protocol?: string },
  ): RtcDataChannelLike;
  createOffer(): Promise<{ sdp?: string }>;
  setLocalDescription(desc: { type: string; sdp?: string }): Promise<void>;
  setRemoteDescription(desc: { type: string; sdp?: string }): Promise<void>;
  readonly localDescription: { sdp?: string } | null;
  close(): void;
}

export interface RtcTransportOptions extends ControllerTransportOptions {
  relayUrl?: string;
  reconnectDelay?: number;
  joinTimeoutMs?: number;
  signalingSocketFactory?: (url: string) => SocketConnection;
  peerConnectionFactory?: (config: {
    iceServers: ICEServer[];
    iceTransportPolicy?: string;
  }) => RtcPeerConnectionLike;
}

// RtcTransport implements ControllerTransport over WebRTC: one signaling
// socket for SDP, a reliable ordered control channel for JSON, and an
// unreliable unordered inputs channel for 20-byte frames. Joins offer at
// once; approval-mode pendings tear that PC down and re-offer after accept.
export class RtcTransport implements ControllerTransport {
  private signaling: SocketConnection | undefined;
  private pc: RtcPeerConnectionLike | undefined;
  private control: RtcDataChannelLike | undefined;
  private inputs: RtcDataChannelLike | undefined;
  private pendingId: string | undefined;
  private iceServers: ICEServer[] = [...FALLBACK_ICE_SERVERS];
  private joinSeq = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stateValue: ConnectionState = 'closed';
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private allowReconnect = true;
  private receivedWelcome = false;
  private reconnectId: string | undefined;
  private joinTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly options: RtcTransportOptions;

  constructor(options: RtcTransportOptions) {
    this.options = options;
    this.reconnectId = readSessionValue(RECONNECT_ID_KEY);
  }

  get state(): ConnectionState {
    return this.stateValue;
  }

  connect(): void {
    if (this.stateValue === 'connecting' || this.stateValue === 'hello-sent')
      return;
    this.intentionalClose = false;
    this.allowReconnect = true;
    this.reconnectAttempts = 0;
    this.joinSeq += 1;
    this.openSignaling();
  }
  sendBinary(frame: Uint8Array): boolean {
    const inputs = this.inputs;
    if (inputs?.readyState !== 'open') return false;
    if (this.stateValue !== 'active') return false;
    if (inputs.bufferedAmount > MAX_BUFFERED_BYTES) return false;
    try {
      inputs.send(frame);
      return true;
    } catch {
      return false;
    }
  }

  sendJSON(message: object): boolean {
    const control = this.control;
    if (control?.readyState !== 'open') return false;
    try {
      control.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  selectLayout(id: string): boolean {
    if (this.stateValue !== 'active') return false;
    return this.sendJSON({ type: 'layout.select', id });
  }

  close(reason = 'client_closed'): void {
    const alreadyClosed =
      this.stateValue === 'closed' && !this.signaling && !this.pc;
    this.allowReconnect = false;
    this.intentionalClose = true;
    this.joinSeq += 1;
    this.clearJoinTimer();
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.control?.readyState === 'open')
      this.sendJSON({ type: 'close', reason });
    this.teardownPeer();
    this.pendingId = undefined;
    this.closeSignaling();
    if (this.stateValue !== 'closed') this.setState('closed');
    // WsTransport parity: a repeat close fires nothing.
    if (!alreadyClosed) this.options.onClose?.();
  }

  resetReconnectId(): void {
    this.reconnectId = undefined;
    removeSessionValue(RECONNECT_ID_KEY);
  }

  // armJoinTimer bounds one open-mode join attempt. The relay has no
  // host-to-guest error path for open flows, so a host that admits
  // nothing answers nothing and the guest would sit in connecting until
  // the user gives up. Approval guests never trip it: pending parks the
  // timer until accept, and accept re-arms for the post-accept offer.
  private armJoinTimer(seq: number): void {
    this.clearJoinTimer();
    this.joinTimer = setTimeout(() => {
      this.joinTimer = undefined;
      if (seq !== this.joinSeq || !this.allowReconnect) return;
      if (this.receivedWelcome || this.stateValue === 'active') return;
      this.options.onError?.({
        type: 'error',
        code: 'room_not_found',
        message: 'Room not found or host offline.',
      });
      this.allowReconnect = false;
      this.pendingId = undefined;
      this.teardownPeer();
      this.closeSignaling();
      this.setState('rejected');
    }, this.options.joinTimeoutMs ?? JOIN_TIMEOUT_MS);
  }

  private clearJoinTimer(): void {
    if (this.joinTimer !== undefined) {
      clearTimeout(this.joinTimer);
      this.joinTimer = undefined;
    }
  }

  private openSignaling(): void {
    this.setState('connecting');
    const url = this.options.relayUrl ?? relayJoinURL();
    const socket = this.createSignalingSocket(url);
    this.signaling = socket;
    const seq = this.joinSeq;
    socket.onopen = () => {
      if (socket !== this.signaling || seq !== this.joinSeq) return;
      if (this.intentionalClose || !this.allowReconnect) {
        socket.close();
        return;
      }
      this.reconnectAttempts = 0;
      // Open mode offers at once. Approval mode is offer-less until
      // accept: the join carries no offer, the PC is built post-accept.
      this.armJoinTimer(seq);
      void this.sendJoinRequest(seq);
    };
    socket.onmessage = (event) => {
      if (socket !== this.signaling) return;
      if (typeof event.data !== 'string') return;
      void this.handleSignalingMessage(event.data, seq);
    };
    socket.onerror = () => {
      if (socket !== this.signaling) return;
      if (this.receivedWelcome || this.stateValue === 'active') return;
      // Pre-establishment socket errors surface through onclose; avoid
      // double-reporting while the close is in flight.
    };
    socket.onclose = () => this.handleSignalingClose(socket, seq);
  }

  private createSignalingSocket(url: string): SocketConnection {
    if (this.options.signalingSocketFactory)
      return this.options.signalingSocketFactory(url);
    return new WebSocket(url) as unknown as SocketConnection;
  }

  private createPeerConnection(iceServers: ICEServer[]): RtcPeerConnectionLike {
    if (this.options.peerConnectionFactory) {
      const config: {
        iceServers: ICEServer[];
        iceTransportPolicy?: string;
      } = { iceServers: toRtcIceServers(iceServers) };
      if (isTurnOnly()) config.iceTransportPolicy = 'relay';
      return this.options.peerConnectionFactory(config);
    }
    const config: RTCConfiguration = {
      iceServers: toRtcIceServers(iceServers) as RTCIceServer[],
    };
    if (isTurnOnly()) config.iceTransportPolicy = 'relay';
    return new RTCPeerConnection(config) as unknown as RtcPeerConnectionLike;
  }

  // sendJoinRequest starts one open-mode join flow: build the PC, gather,
  // send the join with offer. Approval-mode pendings tear the PC down
  // and the post-accept offer (startPostAcceptOffer) reuses buildPeerAndOffer.
  private sendJoinRequest(seq: number): Promise<void> {
    return this.buildPeerAndOffer(seq, (offerSdp) => ({
      type: 'join',
      roomCode: normalizeRoomCode(this.options.sessionCode),
      displayName: this.options.displayName?.trim().slice(0, 40) || undefined,
      reconnectId: this.reconnectId,
      offer: offerSdp,
    }));
  }

  // buildPeerAndOffer builds one phone-side PeerConnection with both
  // DataChannels first (host only handles ondatachannel), gathers to
  // completion (non-trickle v1, one relay round-trip), then delivers the
  // SDP through send. A stale seq or a closed transport tears the PC down.
  private async buildPeerAndOffer(
    seq: number,
    send: (offerSdp: string) => Record<string, unknown>,
  ): Promise<void> {
    const pc = this.createPeerConnection(this.iceServers);
    if (seq !== this.joinSeq || !this.allowReconnect) {
      pc.close();
      return;
    }
    this.pc = pc;
    this.wirePeerConnection(pc, seq);
    this.control = pc.createDataChannel(CONTROL_LABEL, {
      ordered: true,
      protocol: DATA_CHANNEL_PROTOCOL,
    });
    this.inputs = pc.createDataChannel(INPUTS_LABEL, {
      ordered: false,
      maxRetransmits: 0,
      protocol: DATA_CHANNEL_PROTOCOL,
    });
    this.wireControlChannel(this.control);
    let offerSdp: string | undefined;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription({ type: 'offer', sdp: offer.sdp });
      await waitForGatheringComplete(pc);
      offerSdp = pc.localDescription?.sdp ?? offer.sdp;
    } catch {
      if (seq !== this.joinSeq) return;
      this.handleAttemptFailed(seq);
      return;
    }
    if (seq !== this.joinSeq || !this.allowReconnect) return;
    if (!offerSdp) {
      this.handleAttemptFailed(seq);
      return;
    }
    this.dumpOfferCandidates(offerSdp);
    this.sendSignaling(send(offerSdp));
  }

  private wirePeerConnection(pc: RtcPeerConnectionLike, seq: number): void {
    pc.onconnectionstatechange = () => {
      debugLog('pc connection state', pc.connectionState ?? 'unknown');
      if (pc !== this.pc || seq !== this.joinSeq) return;
      if (this.intentionalClose || !this.allowReconnect) return;
      // While the signaling wss is still open the signaling flow owns
      // recovery (the relay reply still lands). Once it closed after the
      // answer, a dead PC rejoins fresh: DTLS failure or a control
      // channel that never opens must not strand the user on Joining.
      if (
        !this.receivedWelcome &&
        this.stateValue !== 'active' &&
        this.signaling
      )
        return;
      this.handlePeerDrop();
    };
  }

  private wireControlChannel(control: RtcDataChannelLike): void {
    control.onopen = () => {
      debugLog('control channel open');
      if (control !== this.control) return;
      if (this.intentionalClose || !this.allowReconnect) return;
      this.sendHello();
    };
    control.onmessage = (event) => {
      if (control !== this.control || typeof event.data !== 'string') return;
      this.handleControlMessage(event.data);
    };
    control.onclose = () => {
      if (control !== this.control) return;
      this.control = undefined;
      if (this.intentionalClose || !this.allowReconnect) return;
      // Same rule as the PC handler: live signaling owns recovery,
      // otherwise the drop rejoins fresh.
      if (this.signaling) return;
      this.handlePeerDrop();
    };
  }

  private sendHello(): void {
    debugLog('sending hello');
    const capabilities =
      typeof this.options.capabilities === 'function'
        ? this.options.capabilities()
        : this.options.capabilities;
    const hello: Record<string, unknown> = {
      type: 'hello',
      // Normalized like the join: the host normalizes again server-side.
      sessionCode: normalizeRoomCode(this.options.sessionCode),
      clientVersion: this.options.clientVersion ?? 'airdeck-web/1',
      capabilities,
    };
    const displayName = this.options.displayName?.trim();
    const selectedLayout = this.options.selectedLayout?.trim();
    if (displayName) hello.displayName = displayName.slice(0, 40);
    if (selectedLayout) hello.selectedLayout = selectedLayout;
    if (this.reconnectId) hello.reconnectId = this.reconnectId;
    if (!this.sendJSON(hello)) return;
    this.receivedWelcome = false;
    if (this.stateValue !== 'active' && this.stateValue !== 'welcome-received')
      this.setState('hello-sent');
  }

  // dumpOfferCandidates logs the phone-side gathered candidates behind the
  // debug flag: the offer leaves before joined arrives, so if the phone
  // gathered nothing, pairing is dead before the host even answers.
  private dumpOfferCandidates(sdp: string): void {
    if (!CONTROLLER_DEBUG) return;
    for (const line of sdp.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('a=candidate:'))
        debugLog('offer candidate', trimmed.slice(2));
    }
  }

  private async handleSignalingMessage(
    data: string,
    seq: number,
  ): Promise<void> {
    if (seq !== this.joinSeq) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      return;
    }
    if (!isRecord(parsed) || typeof parsed.type !== 'string') return;
    switch (parsed.type) {
      case 'joined': {
        const answer = typeof parsed.answer === 'string' ? parsed.answer : '';
        if (!answer) return;
        this.clearJoinTimer();
        this.iceServers = readIceServers(parsed.iceServers);
        await this.applyRemoteAnswer(answer, seq);
        return;
      }
      case 'answer': {
        // Approval-mode answer to the post-accept offer.
        const sdp = typeof parsed.sdp === 'string' ? parsed.sdp : '';
        if (!sdp) return;
        this.clearJoinTimer();
        this.pendingId = undefined;
        await this.applyRemoteAnswer(sdp, seq);
        return;
      }
      case 'pending': {
        if (typeof parsed.pendingId !== 'string' || !parsed.pendingId) return;
        // Approval mode: the pre-accept offer is discarded with its local
        // PC. The host burned nothing (no PC before accept); the fresh
        // offer goes out only after accepted. Park the join timer: the
        // guest now waits on the host, not on the network.
        this.clearJoinTimer();
        this.pendingId = parsed.pendingId;
        this.teardownPeer();
        this.setState('waiting');
        return;
      }
      case 'accepted': {
        if (!this.pendingId) return;
        this.iceServers = readIceServers(parsed.iceServers);
        this.armJoinTimer(seq);
        await this.startPostAcceptOffer(seq);
        return;
      }
      case 'rejected': {
        const reason =
          typeof parsed.reason === 'string' && parsed.reason
            ? parsed.reason
            : 'The host declined your join.';
        this.clearJoinTimer();
        this.options.onError?.({
          type: 'error',
          code: 'declined',
          message: reason,
        });
        this.allowReconnect = false;
        this.pendingId = undefined;
        this.teardownPeer();
        this.closeSignaling();
        this.setState('declined');
        return;
      }
      case 'peer.left': {
        this.clearJoinTimer();
        this.options.onError?.({
          type: 'error',
          code: 'peer_left',
          message: 'The host went offline before the join completed.',
        });
        this.allowReconnect = false;
        this.pendingId = undefined;
        this.teardownPeer();
        this.closeSignaling();
        this.setState('rejected');
        return;
      }
      case 'error': {
        const code = typeof parsed.code === 'string' ? parsed.code : '';
        const message =
          typeof parsed.message === 'string' && parsed.message
            ? parsed.message
            : 'Room not found or host offline.';
        this.clearJoinTimer();
        this.options.onError?.({ type: 'error', code, message });
        if (!this.receivedWelcome) {
          this.allowReconnect = false;
          this.pendingId = undefined;
          this.teardownPeer();
          this.closeSignaling();
          this.setState(code === 'declined' ? 'declined' : 'rejected');
        }
        return;
      }
      default:
        return;
    }
  }

  private async applyRemoteAnswer(sdp: string, seq: number): Promise<void> {
    debugLog('answer received', { bytes: sdp.length });
    const pc = this.pc;
    if (!pc || seq !== this.joinSeq) return;
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp });
    } catch {
      if (seq !== this.joinSeq) return;
      this.handleAttemptFailed(seq);
      return;
    }
    if (seq !== this.joinSeq) return;
    // Signaling is done: the guest closes its wss and post-establishment
    // state belongs to the host PeerConnection.
    this.closeSignaling();
    this.receivedWelcome = false;
    this.setState('hello-sent');
  }

  // startPostAcceptOffer rebuilds the PC against the accepted TURN bundle
  // so the approval-mode offer gathers srflx plus relay candidates from
  // the start, then sends it as a bare offer message on the same wss.
  private startPostAcceptOffer(seq: number): Promise<void> {
    this.teardownPeer();
    return this.buildPeerAndOffer(seq, (offerSdp) => ({
      type: 'offer',
      pendingId: this.pendingId,
      sdp: offerSdp,
    }));
  }

  private handleAttemptFailed(seq: number): void {
    if (seq !== this.joinSeq) return;
    this.teardownPeer();
    this.handleSignalingClose(this.signaling, seq, true);
  }

  private handlePeerDrop(): void {
    this.teardownPeer();
    this.options.onReconnect?.();
    this.setState('reconnecting');
    this.scheduleRejoin();
  }

  private handleSignalingClose(
    socket: SocketConnection | undefined,
    seq: number,
    force = false,
  ): void {
    if (!force && socket !== this.signaling) return;
    this.signaling = undefined;
    // Post-establishment the signaling wss is already closed by design;
    // its close never triggers a rejoin.
    if (seq !== this.joinSeq) return;
    if (this.intentionalClose || !this.allowReconnect) {
      if (
        this.stateValue !== 'declined' &&
        this.stateValue !== 'rejected' &&
        this.stateValue !== 'closed'
      )
        this.setState('closed');
      if (this.intentionalClose) this.options.onClose?.();
      return;
    }
    // A waiting guest whose socket blips re-queues cleanly: the relay
    // evaporated the old pending on socket close, so the fresh join
    // cannot double-park.
    this.teardownPeer();
    this.options.onReconnect?.();
    this.setState('reconnecting');
    this.scheduleRejoin();
  }

  private scheduleRejoin(): void {
    if (!this.allowReconnect) return;
    const baseDelay = this.options.reconnectDelay ?? 250;
    const delay = Math.min(baseDelay * 2 ** this.reconnectAttempts, 2000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.allowReconnect || this.intentionalClose) return;
      this.joinSeq += 1;
      this.openSignaling();
    }, delay);
  }

  private sendSignaling(message: Record<string, unknown>): boolean {
    if (this.signaling?.readyState !== 1) return false;
    try {
      this.signaling.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  private closeSignaling(): void {
    const socket = this.signaling;
    this.signaling = undefined;
    try {
      socket?.close();
    } catch {
      // Signaling teardown never blocks input.
    }
  }

  private teardownPeer(): void {
    const pc = this.pc;
    this.pc = undefined;
    this.control = undefined;
    this.inputs = undefined;
    try {
      pc?.close();
    } catch {
      // Peer teardown never blocks the rejoin.
    }
  }

  // handleControlMessage carries the current JSON protocol untouched
  // (hello, welcome, layout, ping/pong, rumble, error, close).
  private handleControlMessage(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      this.reportError('invalid_message', 'The host sent an invalid message.');
      return;
    }
    dispatchControlMessage(parsed, {
      onWelcome: (message) => {
        if (this.receivedWelcome) {
          this.reportError(
            'invalid_message',
            'The host sent a duplicate welcome.',
          );
          return;
        }
        this.handleWelcome(message);
      },
      onLayout: (message) => this.handleLayout(message),
      onLayouts: (message) => this.handleLayouts(message),
      onSlotUpdate: (slot, accent) =>
        this.options.onSlotUpdate?.({ type: 'slot.update', slot, accent }),
      onPing: (id, rttMs) => {
        if (rttMs !== undefined) this.options.onPing?.(rttMs);
        this.sendJSON({ type: 'pong', id });
      },
      onRumble: (strong, weak, active) =>
        this.options.onRumble?.({ type: 'rumble', strong, weak, active }),
      onControlError: (code, message) => this.handleError({ code, message }),
      onClose: (reason) => {
        this.intentionalClose = true;
        this.allowReconnect = false;
        if (reason === 'kicked' || reason === 'kick') this.setState('kicked');
        else this.setState('closed');
        this.teardownPeer();
        this.closeSignaling();
      },
      onSessionReset: () => {
        this.resetReconnectId();
        this.intentionalClose = true;
        this.allowReconnect = false;
        this.setState('session-reset');
        this.teardownPeer();
        this.closeSignaling();
      },
      onPublishResult: (id, status) =>
        this.options.onPublishResult?.({
          type: 'publish.result',
          id,
          status: status as 'accepted' | 'declined' | 'expired' | 'cancelled',
        }),
      reportError: (code, message) => this.reportError(code, message),
    });
  }

  private handleWelcome(message: Welcome): void {
    if (!isValidWelcome(message)) {
      this.allowReconnect = false;
      this.setState('rejected');
      this.reportError(
        'invalid_welcome',
        'The host sent an invalid controller welcome.',
      );
      this.teardownPeer();
      this.closeSignaling();
      return;
    }
    this.receivedWelcome = true;
    this.clearJoinTimer();
    this.reconnectAttempts = 0;
    this.reconnectId = message.reconnectId;
    writeSessionValue(RECONNECT_ID_KEY, message.reconnectId);
    this.options.onWelcome?.(message);
    this.setState('welcome-received');
  }

  private handleLayout(message: LayoutMessage): void {
    const resolved = parseLayoutDocument(message.layout);
    this.options.onLayout?.(resolved.layout, resolved.diagnostic);
    if (this.receivedWelcome && this.stateValue === 'welcome-received')
      this.setState('active');
  }

  private handleLayouts(message: LayoutsMessage): void {
    const layouts = isValidLayouts(message);
    if (layouts === undefined) {
      this.reportError(
        'invalid_message',
        'The host sent an invalid layouts update.',
      );
      return;
    }
    this.options.onLayouts?.(layouts);
  }

  private handleError(message: { code: string; message: string }): void {
    this.options.onError?.({ type: 'error', ...message });
    if (
      message.code === 'invalid_reconnect' ||
      message.code === 'invalid_code'
    ) {
      this.resetReconnectId();
    }
    if (!this.receivedWelcome) {
      this.allowReconnect = false;
      this.setState(message.code === 'declined' ? 'declined' : 'rejected');
    }
  }

  private setState(state: ConnectionState): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    this.options.onStateChange?.(state);
  }

  private reportError(code: string, message: string): void {
    this.options.onError?.({ type: 'error', code, message });
  }
}

function waitForGatheringComplete(pc: RtcPeerConnectionLike): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, GATHER_TIMEOUT_MS);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
  });
}

function toRtcIceServers(servers: ICEServer[]): ICEServer[] {
  const mapped = servers
    .filter((server) => Array.isArray(server.urls) && server.urls.length > 0)
    .map((server) => ({
      urls: [...server.urls],
      ...(server.username ? { username: server.username } : {}),
      ...(server.credential ? { credential: server.credential } : {}),
    }));
  return mapped.length > 0 ? mapped : [...FALLBACK_ICE_SERVERS];
}

function readIceServers(value: unknown): ICEServer[] {
  if (!Array.isArray(value)) return [...FALLBACK_ICE_SERVERS];
  const servers: ICEServer[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !Array.isArray(entry.urls)) continue;
    const urls = (entry.urls as unknown[]).filter(
      (url): url is string => typeof url === 'string' && url.length > 0,
    );
    if (urls.length === 0) continue;
    servers.push({
      urls,
      ...(typeof entry.username === 'string' && entry.username
        ? { username: entry.username }
        : {}),
      ...(typeof entry.credential === 'string' && entry.credential
        ? { credential: entry.credential }
        : {}),
    });
  }
  return servers.length > 0 ? servers : [...FALLBACK_ICE_SERVERS];
}
