import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceAdapter } from '../packages/dsh-plugin/src/voice.js';

function fixture({ conflict = false, decode, transcribe } = {}) {
  let tracksStopped = 0, uploads = 0, inserted = null, current = true;
  const span = {}, samples = new Float32Array([0, 1, -1, 0.5]);
  class Recorder {
    constructor() { this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2])]) }); this.onstop?.(); });
    }
  }
  class Audio {
    async decodeAudioData() { if (decode) await decode(); return { duration: 4 / 16000, sampleRate: 16000, length: 4, numberOfChannels: 1, getChannelData: () => samples }; }
    async close() {}
  }
  const speech = {
    async catalog() { return { ok: true, value: { selection: { providerId: 'local', language: 'zh' },
      providers: [{ id: 'local', name: '本地识别', location: 'local', preparation: { phase: 'ready' } }], maxAudioBytes: 10000, maxDurationSeconds: 10 } }; },
    async transcribe(request, signal) { uploads++; if (transcribe) return transcribe(request, signal);
      const data = Buffer.from(request.audioBase64, 'base64');
      assert.equal(data.toString('ascii', 0, 4), 'RIFF'); assert.equal(data.toString('ascii', 8, 12), 'WAVE');
      assert.equal(data.readUInt16LE(22), 1); assert.equal(data.readUInt32LE(24), 16000); assert.equal(data.readUInt16LE(34), 16);
      assert.equal(data.readUInt32LE(40), 8); assert.equal(data.length, 52);
      assert.deepEqual([data.readInt16LE(44), data.readInt16LE(46), data.readInt16LE(48), data.readInt16LE(50)], [0, 32767, -32768, 16384]);
      return { ok: true, value: { text: '你好，DSH' } };
    },
  };
  const target = { sessionId: 'session-a', context: 'context-a', inputActions: {
    captureInsertion() { return span; }, insertText(text, captured) { assert.equal(captured, span); inserted = text; return !conflict; },
    submit() { assert.fail('voice must never submit'); },
  } };
  const voice = createVoiceAdapter({ speech, media: { async getUserMedia() { return { getTracks: () => [{ stop() { tracksStopped++; } }] }; } }, Recorder, Audio,
    isCurrent: value => current && value === target });
  return { voice, target, speech, invalidate() { current = false; }, get tracksStopped() { return tracksStopped; }, get uploads() { return uploads; }, get inserted() { return inserted; } };
}

test('voice explicitly authorizes microphone without recording or uploading, then inserts canonical WAV transcription without submit', async () => {
  const f = fixture();
  assert.equal(f.voice.snapshot().enabled, false); assert.equal(await f.voice.start(f.target), false); assert.equal(f.tracksStopped, 0);
  assert.equal(await f.voice.enable(), true); assert.equal(f.tracksStopped, 1); assert.equal(f.uploads, 0);
  assert.equal(await f.voice.start(f.target), true); assert.equal(f.voice.snapshot().phase, 'recording');
  assert.equal(await f.voice.finish(), true); assert.equal(f.uploads, 1); assert.equal(f.inserted, '你好，DSH'); assert.equal(f.tracksStopped, 2);
  assert.equal(f.voice.snapshot().phase, 'ready'); f.voice.dispose();
});

test('voice context change before transcription drops audio without upload or draft edits', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = fixture({ decode: () => wait });
  await f.voice.enable(); await f.voice.start(f.target);
  const finish = f.voice.finish(); await new Promise(resolve => setImmediate(resolve));
  f.invalidate(); f.voice.cancel(); release();
  assert.equal(await finish, false); assert.equal(f.uploads, 0); assert.equal(f.inserted, null); f.voice.dispose();
});

test('voice drops late server transcription after context invalidation', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; }); let uploadStarted;
  const uploading = new Promise(resolve => { uploadStarted = resolve; });
  const f = fixture({ async transcribe(_request, signal) { uploadStarted(); await wait; assert.equal(signal.aborted, true); return { ok: true, value: { text: 'late' } }; } });
  await f.voice.enable(); await f.voice.start(f.target); const finish = f.voice.finish(); await uploading;
  f.invalidate(); f.voice.cancel(); release(); assert.equal(await finish, false); assert.equal(f.inserted, null); f.voice.dispose();
});

test('voice retains transcription for explicit user recovery when draft insertion conflicts', async () => {
  const f = fixture({ conflict: true }); await f.voice.enable(); await f.voice.start(f.target);
  assert.equal(await f.voice.finish(), false); assert.equal(f.voice.snapshot().error, 'voice_draft_changed');
  assert.equal(f.voice.snapshot().conflictText, '你好，DSH'); assert.equal(await f.voice.start(f.target), false);
  f.voice.disable(); assert.equal(f.voice.snapshot().conflictText, ''); assert.equal(f.voice.snapshot().enabled, false); f.voice.dispose();
});

test('voice does not request microphone before a usable configured speech provider exists', async () => {
  const f = fixture(); f.speech.catalog = async () => ({ ok: false, error: 'not configured' });
  assert.equal(await f.voice.enable(), false); assert.equal(f.tracksStopped, 0); assert.equal(f.voice.snapshot().error, 'voice_not_configured'); f.voice.dispose();
});
