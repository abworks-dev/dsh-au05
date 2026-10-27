import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { decryptTeaBlock, decodeInputReport, parseInputPlaintext } from '../packages/core/hid-input.mjs';

// Synthetic fixtures only, not captured AU05 traffic. This encoder is test-local:
// it has no exports, native calls, transport or HID output capability.
function fixture(firstBytes) {
  const source = Buffer.alloc(64); source.set(firstBytes);
  const encrypted = Buffer.alloc(64);
  const keys = [0xCAA5BACA, 0xBC2A8A6D, 0xCA5A9EBA, 0x9BB88BCA];
  for (let i = 0; i < 64; i += 8) {
    let x = source.readUInt32LE(i), y = source.readUInt32LE(i + 4), total = 0;
    for (let r = 0; r < 32; r++) {
      total = (total + 0x9E3779B9) >>> 0;
      x = (x + ((((y << 4) + keys[0]) ^ (y + total) ^ ((y >>> 5) + keys[1])) >>> 0)) >>> 0;
      y = (y + ((((x << 4) + keys[2]) ^ (x + total) ^ ((x >>> 5) + keys[3])) >>> 0)) >>> 0;
    }
    encrypted.writeUInt32LE(x, i); encrypted.writeUInt32LE(y, i + 4);
  }
  return Buffer.concat([Buffer.from([0x55]), encrypted.subarray(0, 63)]);
}

test('TEA independent zero-key/zero-plaintext known-answer vector, little endian', () => {
  // Standard TEA zero vector: words 41EA3A0A 94BAA940; bytes below are LE.
  const result = decryptTeaBlock(Buffer.from('0a3aea4140a9ba94', 'hex'), [0, 0, 0, 0]);
  assert.deepEqual(result, Buffer.alloc(8));
  assert.throws(() => decryptTeaBlock(Buffer.alloc(7)), /invalid_tea_block/);
  assert.throws(() => decryptTeaBlock(Buffer.alloc(8), [0, 0, -1, 0]), /invalid_tea_key/);
});

test('synthetic reports decode all controls without exposing payloads', () => {
  for (const route of [0x0B, 0x8B]) for (const [physical, control] of ['k1', 'k2', 'k3', 'knob', 'right', 'left'].entries()) {
    for (const phase of [0, 1]) {
      const report = fixture([route, 0x10, 0xEE, phase, physical]);
      const before = Buffer.from(report);
      const result = decodeInputReport(report);
      assert.deepEqual(result, { type: 'input', control, phase: physical >= 4 ? 'pulse' : phase ? 'down' : 'up' });
      assert.deepEqual(report, before, 'decoding must not mutate input');
      assert.ok(Object.isFrozen(result));
    }
  }
});

test('truncated tail is ignored and malformed report ID/length rejected', () => {
  const report = fixture([0x8B, 0x10, 0, 1, 0]);
  const expected = decodeInputReport(report);
  report.fill(0xFF, 57);
  assert.deepEqual(decodeInputReport(report), expected);
  for (const length of [0, 5, 56, 63, 65])
    assert.throws(() => decodeInputReport(Buffer.alloc(length)), /invalid_input_length/);
  report[0] = 0x56;
  assert.throws(() => decodeInputReport(report), /invalid_report_id/);
});

test('unknown commands, control IDs and phases are not fabricated into actions', () => {
  for (const bytes of [[0x01, 0x10, 0, 1, 0], [0x8B, 0x11, 0, 1, 0],
    [0x8B, 0x10, 0, 1, 6], [0x8B, 0x10, 0, 2, 0], [0x8B, 0x10, 0, 0xFF, 4]])
    assert.equal(decodeInputReport(fixture(bytes)), null);
  assert.equal(parseInputPlaintext(Buffer.alloc(4)), null);
  assert.equal(parseInputPlaintext(null), null);
  for (let i = 0; i < 1000; i++) {
    const report = randomBytes(64); report[0] = 0x55;
    const result = decodeInputReport(report);
    if (result !== null) assert.ok(['k1', 'k2', 'k3', 'knob', 'right', 'left'].includes(result.control));
  }
});

test('consecutive identical rotary reports are preserved, no time-window dedup', () => {
  const right = fixture([0x8B, 0x10, 0, 1, 4]);
  const events = Array.from({ length: 20 }, () => decodeInputReport(right));
  assert.equal(events.length, 20);
  assert.ok(events.every(event => event.control === 'right' && event.phase === 'pulse'));
});
