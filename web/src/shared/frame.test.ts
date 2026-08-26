import { describe, expect, it } from 'vitest';
import { encodeFrame } from './frame';

describe('encodeFrame', () => {
  it('encodes the 20-byte protocol vector', () => {
    const frame = encodeFrame({
      seq: 0x01020304,
      buttons: 0x4081,
      lx: -2,
      ly: 3,
      rx: -32768,
      ry: 32767,
      lt: 17,
      rt: 255,
    });
    expect([...frame]).toEqual([
      1, 0, 4, 3, 2, 1, 0x81, 0x40, 0, 0, 0xfe, 0xff, 3, 0, 0, 0x80, 0xff, 0x7f,
      17, 255,
    ]);
  });
});
