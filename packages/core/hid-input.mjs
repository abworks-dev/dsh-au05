// Input-only AU05 decoding. No encoder, output report or hardware I/O is exported.
// TEA is protocol obfuscation, NOT authentication. See docs/sources.md.
const KEY = Object.freeze([0xCAA5BACA, 0xBC2A8A6D, 0xCA5A9EBA, 0x9BB88BCA]);
const CONTROLS = Object.freeze(['k1', 'k2', 'k3', 'knob', 'right', 'left']);

export function decryptTeaBlock(block, key = KEY) {
  if (!(block instanceof Uint8Array) || block.byteLength !== 8) throw new TypeError('invalid_tea_block');
  if (!Array.isArray(key) || key.length !== 4 || key.some(k => !Number.isInteger(k) || k < 0 || k > 0xFFFFFFFF))
    throw new TypeError('invalid_tea_key');
  const data = Buffer.from(block);
  let a = data.readUInt32LE(0), b = data.readUInt32LE(4), sum = 0xC6EF3720;
  const mix = (word, left, right) => (((word << 4) + left) ^ (word + sum) ^ ((word >>> 5) + right)) >>> 0;
  for (let round = 0; round < 32; round++) {
    b = (b - mix(a, key[2], key[3])) >>> 0;
    a = (a - mix(b, key[0], key[1])) >>> 0;
    sum = (sum - 0x9E3779B9) >>> 0;
  }
  const result = Buffer.alloc(8);
  result.writeUInt32LE(a, 0); result.writeUInt32LE(b, 4);
  return result;
}

// Windows report includes ID 0x55 and exactly 63 encrypted bytes.
// Only the first 56 bytes are complete blocks; never decrypt the trailing 7.
export function decodeInputReport(report) {
  if (!(report instanceof Uint8Array) || report.byteLength !== 64) throw new TypeError('invalid_input_length');
  if (report[0] !== 0x55) throw new TypeError('invalid_report_id');
  const plain = Buffer.alloc(56);
  for (let offset = 0; offset < 56; offset += 8)
    decryptTeaBlock(report.subarray(1 + offset, 9 + offset)).copy(plain, offset);
  return parseInputPlaintext(plain);
}

export function parseInputPlaintext(plain) {
  if (!(plain instanceof Uint8Array) || plain.byteLength < 5) return null;
  // This event has its own layout, not the generic command's four-byte header.
  if ((plain[0] !== 0x0B && plain[0] !== 0x8B) || plain[1] !== 0x10) return null;
  const physical = plain[4], phase = plain[3];
  if (physical > 5 || (phase !== 0 && phase !== 1)) return null;
  return Object.freeze({ type: 'input', control: CONTROLS[physical],
    phase: physical >= 4 ? 'pulse' : phase === 1 ? 'down' : 'up' });
}
