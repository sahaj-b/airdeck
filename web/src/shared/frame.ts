import { FRAME_SIZE, PROTOCOL_VERSION } from './contracts';

export interface InputFrame {
  seq: number;
  buttons: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  lt: number;
  rt: number;
}

export function encodeFrame(frame: InputFrame): Uint8Array {
  const data = new Uint8Array(FRAME_SIZE);
  const view = new DataView(data.buffer);
  data[0] = PROTOCOL_VERSION;
  data[1] = 0;
  view.setUint32(2, frame.seq >>> 0, true);
  view.setUint32(6, frame.buttons & 0x7fff, true);
  view.setInt16(10, clampInt16(frame.lx), true);
  view.setInt16(12, clampInt16(frame.ly), true);
  view.setInt16(14, clampInt16(frame.rx), true);
  view.setInt16(16, clampInt16(frame.ry), true);
  data[18] = clampByte(frame.lt);
  data[19] = clampByte(frame.rt);
  return data;
}

function clampInt16(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}
function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
