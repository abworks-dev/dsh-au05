import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceAdapter } from '../packages/dsh-plugin/src/voice.js';

const input = (deviceId, label, groupId = deviceId) => ({ kind: 'audioinput', deviceId, label, groupId });
const devices = () => [input('default', 'Default - Built-in microphone', 'builtin'), input('builtin', 'Built-in microphone'),
  input('au05', 'Microphone (AU05)'), { kind: 'audiooutput', deviceId: 'speaker', label: 'Speakers' }];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function events() {
  const handlers = new Map();
  return {
    addEventListener(name, handler) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(handler); },
    removeEventListener(name, handler) { handlers.get(name)?.delete(handler); },
    emit(name) { for (const handler of [...(handlers.get(name) ?? [])]) handler(); },
    listeners(name) { return handlers.get(name)?.size ?? 0; },
  };
}
function fixture(options = {}) {
  const state = { devices: options.devices ?? devices(), permission: false, catalogCalls: 0, enumerateCalls: 0,
    constraints: [], tracks: [], recorderStarts: 0, uploads: 0, inserted: [], snapshots: [], active: true };
  const streamFor = deviceId => {
    const track = { ...events(), stops: 0, readyState: 'live', getSettings: () => ({ deviceId }),
      stop() { this.stops++; this.readyState = 'ended'; this.emit('ended'); },
      end() { this.readyState = 'ended'; this.emit('ended'); } };
    state.tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  };
  const media = { ...events(),
    async enumerateDevices() {
      state.enumerateCalls++;
      if (options.enumerate) return options.enumerate(state);
      return state.devices.map(item => ({ ...item, ...(options.hideLabels && !state.permission ? { label: '' } : {}) }));
    },
    async getUserMedia(constraints) {
      state.constraints.push(constraints); state.permission = true;
      if (options.acquire) return options.acquire(constraints, state, streamFor);
      const selected = constraints.audio.deviceId?.exact;
      return streamFor(!selected || selected === 'default' ? 'builtin' : selected);
    },
  };
  if (options.noEnumeration) delete media.enumerateDevices;
  class Recorder {
    constructor() { this.state = 'inactive'; }
    start() { this.state = 'recording'; state.recorderStarts++; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2])]) }); this.onstop?.(); });
    }
  }
  class Audio {
    async decodeAudioData() { return { duration: 2 / 16000, sampleRate: 16000, length: 2, numberOfChannels: 1, getChannelData: () => new Float32Array([0, 1]) }; }
    async close() {}
  }
  const speech = {
    async catalog() {
      state.catalogCalls++;
      if (options.catalog) return options.catalog(state);
      return { ok: true, value: { selection: { providerId: 'local', language: 'zh' },
        providers: [{ id: 'local', name: 'Local', location: 'local', preparation: { phase: 'ready' } }], maxAudioBytes: 10000, maxDurationSeconds: 10 } };
    },
    async transcribe(request, signal) {
      state.uploads++;
      if (options.transcribe) return options.transcribe(request, signal);
      return { ok: true, value: { text: 'transcript' } };
    },
  };
  const insertion = {};
  const target = { inputActions: { captureInsertion: () => insertion, insertText(text, span) {
    assert.equal(span, insertion); state.inserted.push(text); return true;
  } } };
  const voice = createVoiceAdapter({ speech, media, Recorder, Audio, onChange: value => state.snapshots.push(value),
    isCurrent: value => state.active && value === target });
  return { voice, media, state, target, streamFor };
}

test('settings restore is synchronous opt-in hydration with no catalog, microphone, recording or enumeration', async () => {
  const f = fixture();
  const result = f.voice.restore({ enabled: true, microphoneId: 'au05' });
  assert.equal(typeof result?.then, 'undefined');
  assert.equal(result.enabled, true); assert.equal(result.phase, 'ready'); assert.equal(result.ready, true);
  assert.equal(result.prepared, false); assert.equal(result.preparing, false); assert.equal(result.microphoneId, 'au05');
  assert.deepEqual(result.microphones, []); assert.equal(result.microphoneError, null);
  await tick();
  assert.equal(f.state.catalogCalls, 0); assert.equal(f.state.enumerateCalls, 0); assert.equal(f.state.constraints.length, 0);
  assert.equal(f.state.recorderStarts, 0); assert.equal(f.state.uploads, 0);
  assert.deepEqual(f.state.snapshots.at(-1), result);
  f.voice.restore(); assert.equal(f.voice.snapshot().enabled, false); assert.equal(f.voice.snapshot().microphoneId, null);
  f.voice.dispose();
});

test('restored opt-in prepares catalog lazily only for a valid explicit start and acquires the exact pinned microphone', async () => {
  const f = fixture(); f.voice.restore({ enabled: true, microphoneId: 'builtin' });
  assert.equal(await f.voice.start({}), false); assert.equal(f.state.catalogCalls, 0); assert.equal(f.state.enumerateCalls, 0);
  assert.equal(await f.voice.start(f.target), true);
  assert.equal(f.state.catalogCalls, 1); assert.equal(f.state.constraints.length, 1);
  assert.deepEqual(f.state.constraints[0].audio.deviceId, { exact: 'builtin' });
  assert.equal(f.voice.snapshot().prepared, true); assert.equal(f.voice.snapshot().preparing, false);
  assert.equal(await f.voice.finish(), true); assert.deepEqual(f.state.inserted, ['transcript']);
  f.voice.dispose();
});

test('refresh enumerates audio inputs only, prefers AU05, publishes full snapshots and never opens audio', async () => {
  const f = fixture();
  const result = await f.voice.refreshMicrophones();
  assert.equal(result.microphoneId, 'au05');
  assert.deepEqual(result.microphones, devices().filter(item => item.kind === 'audioinput').map(({ deviceId, label }) => ({ deviceId, label })));
  assert.equal(f.state.constraints.length, 0); assert.equal(f.state.catalogCalls, 0); assert.equal(f.state.recorderStarts, 0);
  assert.deepEqual(f.state.snapshots.at(-1), result);
  result.microphones[0].label = 'changed outside'; assert.notEqual(f.voice.snapshot().microphones[0].label, 'changed outside');
  f.voice.dispose();
});

test('explicit enable stops permission stream, unlocks labels and pins AU05 for the next exact recording acquisition', async () => {
  const f = fixture({ hideLabels: true });
  assert.equal(await f.voice.enable(), true);
  assert.equal(f.state.constraints.length, 1); assert.equal(f.state.constraints[0].audio.deviceId, undefined);
  assert.equal(f.state.tracks[0].stops, 1); assert.equal(f.state.recorderStarts, 0); assert.equal(f.state.uploads, 0);
  assert.equal(f.voice.snapshot().microphoneId, 'au05');
  assert.equal(await f.voice.start(f.target), true);
  assert.deepEqual(f.state.constraints[1].audio.deviceId, { exact: 'au05' });
  f.voice.cancel(); assert.equal(f.state.tracks[1].stops, 1); f.voice.dispose();
});

test('first-use restored start stops default stream and reacquires preferred AU05 after labels become accessible', async () => {
  const f = fixture({ hideLabels: true }); f.voice.restore({ enabled: true });
  assert.equal(await f.voice.start(f.target), true);
  assert.equal(f.state.constraints.length, 2); assert.equal(f.state.constraints[0].audio.deviceId, undefined);
  assert.deepEqual(f.state.constraints[1].audio.deviceId, { exact: 'au05' });
  assert.equal(f.state.tracks[0].stops, 1); assert.equal(f.state.recorderStarts, 1);
  assert.equal(f.voice.snapshot().microphoneId, 'au05'); f.voice.dispose();
});

test('manual selection wins over AU05; permission and recording both use exact constraints', async () => {
  const f = fixture();
  assert.equal(f.voice.selectMicrophone('builtin'), true); assert.equal(f.state.constraints.length, 0); assert.equal(f.state.enumerateCalls, 0);
  assert.equal(await f.voice.enable(), true); assert.equal(f.voice.snapshot().microphoneId, 'builtin');
  assert.equal(await f.voice.start(f.target), true);
  assert.deepEqual(f.state.constraints.map(item => item.audio.deviceId), [{ exact: 'builtin' }, { exact: 'builtin' }]);
  const track = f.state.tracks.at(-1);
  assert.equal(f.voice.selectMicrophone('builtin'), true); assert.equal(track.stops, 0); assert.equal(f.voice.snapshot().phase, 'recording');
  assert.equal(f.voice.selectMicrophone('au05'), true); assert.equal(track.stops, 1); assert.equal(f.voice.snapshot().phase, 'ready');
  assert.equal(f.state.constraints.length, 2); assert.equal(f.state.uploads, 0); f.voice.dispose();
});

test('auto choice resolves system-default physical microphone, then never switches even when AU05 appears', async () => {
  const f = fixture({ devices: devices().filter(item => item.deviceId !== 'au05') });
  await f.voice.refreshMicrophones(); assert.equal(f.voice.snapshot().microphoneId, 'builtin');
  f.state.devices = devices(); await f.voice.refreshMicrophones(); assert.equal(f.voice.snapshot().microphoneId, 'builtin');
  assert.equal(f.voice.selectMicrophone(null), true); assert.equal(f.voice.snapshot().microphoneId, null);
  await f.voice.refreshMicrophones(); assert.equal(f.voice.snapshot().microphoneId, 'au05'); f.voice.dispose();
});

test('explicit OS default remains an alias, is constrained exactly, and accepts its resolved physical track ID', async () => {
  const f = fixture(); f.voice.selectMicrophone('default');
  assert.equal(await f.voice.enable(), true); assert.equal(await f.voice.start(f.target), true);
  assert.equal(f.voice.snapshot().microphoneId, 'default');
  assert.deepEqual(f.state.constraints.map(item => item.audio.deviceId), [{ exact: 'default' }, { exact: 'default' }]); f.voice.dispose();
});

test('missing persisted or manually selected input fails closed before acquisition, with no default fallback', async () => {
  const f = fixture(); f.voice.restore({ enabled: true, microphoneId: 'removed' });
  assert.equal(await f.voice.start(f.target), false); assert.equal(f.state.constraints.length, 0);
  assert.equal(f.voice.snapshot().microphoneId, 'removed'); assert.equal(f.voice.snapshot().error, 'voice_microphone_missing');
  assert.equal(f.voice.snapshot().microphoneError, 'voice_microphone_missing');
  assert.equal(await f.voice.enable(), false); assert.equal(f.state.constraints.length, 0);
  assert.equal(f.voice.selectMicrophone('also-removed'), true); assert.equal(f.voice.snapshot().microphoneId, 'also-removed');
  assert.equal(f.voice.snapshot().microphoneError, 'voice_microphone_missing'); f.voice.dispose();
});

test('devicechange removal cancels recording, retains selection, and reappearance never auto-restarts', async () => {
  const f = fixture(); f.voice.restore({ enabled: true, microphoneId: 'au05' }); await f.voice.start(f.target);
  const track = f.state.tracks.at(-1); assert.equal(track.listeners('ended'), 1);
  f.state.devices = devices().filter(item => item.deviceId !== 'au05'); f.media.emit('devicechange'); await tick();
  assert.equal(track.stops, 1); assert.equal(track.listeners('ended'), 0); assert.equal(f.voice.snapshot().phase, 'error');
  assert.equal(f.voice.snapshot().microphoneError, 'voice_microphone_missing'); assert.equal(f.voice.snapshot().microphoneId, 'au05');
  assert.equal(await f.voice.finish(), false); assert.equal(f.state.uploads, 0);
  f.state.devices = devices(); f.media.emit('devicechange'); await tick();
  assert.equal(f.voice.snapshot().microphoneError, null); assert.equal(f.state.constraints.length, 1); assert.equal(f.state.recorderStarts, 1);
  f.voice.dispose(); assert.equal(f.media.listeners('devicechange'), 0);
});

test('unexpected track ended cancels recording with a fixed missing error and no upload', async () => {
  const f = fixture(); f.voice.restore({ enabled: true, microphoneId: 'au05' }); await f.voice.start(f.target);
  f.state.tracks.at(-1).end();
  assert.equal(f.voice.snapshot().phase, 'error'); assert.equal(f.voice.snapshot().error, 'voice_microphone_missing');
  assert.equal(f.voice.snapshot().microphoneId, 'au05'); assert.equal(await f.voice.finish(), false); assert.equal(f.state.uploads, 0); f.voice.dispose();
});

test('permission stream mismatch fails closed, stops every acquired track, and never records', async () => {
  const f = fixture({ acquire: (_constraints, _state, streamFor) => streamFor('wrong-input') }); f.voice.selectMicrophone('au05');
  assert.equal(await f.voice.enable(), false); assert.equal(f.state.constraints.length, 1);
  assert.deepEqual(f.state.constraints[0].audio.deviceId, { exact: 'au05' });
  assert.equal(f.state.tracks[0].stops, 1); assert.equal(f.voice.snapshot().error, 'voice_microphone_mismatch');
  assert.equal(f.voice.snapshot().microphoneId, 'au05'); assert.equal(f.state.recorderStarts, 0); f.voice.dispose();
});

test('recording stream mismatch fails closed and never uploads or falls back', async () => {
  const f = fixture({ acquire: (_constraints, _state, streamFor) => streamFor('wrong-input') });
  f.voice.restore({ enabled: true, microphoneId: 'au05' });
  assert.equal(await f.voice.start(f.target), false); assert.equal(f.state.constraints.length, 1); assert.equal(f.state.tracks[0].stops, 1);
  assert.equal(f.voice.snapshot().microphoneError, 'voice_microphone_mismatch'); assert.equal(f.state.recorderStarts, 0); assert.equal(f.state.uploads, 0); f.voice.dispose();
});

test('enumeration unsupported retains legacy unselected default only, never silently accepts a concrete or OS-default selection', async () => {
  const f = fixture({ noEnumeration: true }); f.voice.restore({ enabled: true });
  assert.equal(await f.voice.start(f.target), true); assert.equal(f.state.constraints[0].audio.deviceId, undefined); f.voice.cancel();
  for (const microphoneId of ['au05', 'default']) {
    f.voice.restore({ enabled: true, microphoneId }); assert.equal(await f.voice.start(f.target), false);
    assert.equal(f.voice.snapshot().microphoneError, 'voice_microphone_unavailable'); assert.equal(f.state.constraints.length, 1);
  }
  f.voice.dispose();
});

test('selection change invalidates pending permission and cleans up its late stream without overwriting choice', async () => {
  const gate = deferred(), entered = deferred();
  const f = fixture({ async acquire(_constraints, _state, streamFor) { entered.resolve(); await gate.promise; return streamFor('au05'); } });
  f.voice.selectMicrophone('au05'); const enabling = f.voice.enable(); await entered.promise;
  assert.equal(f.voice.selectMicrophone('builtin'), true); gate.resolve();
  assert.equal(await enabling, false); assert.equal(f.state.tracks[0].stops, 1); assert.equal(f.voice.snapshot().microphoneId, 'builtin');
  assert.equal(f.voice.snapshot().enabled, false); assert.equal(f.state.recorderStarts, 0); f.voice.dispose();
});

test('selection change invalidates a pending recording acquisition and stops the late stream', async () => {
  const gate = deferred(), entered = deferred();
  const f = fixture({ async acquire(_constraints, _state, streamFor) { entered.resolve(); await gate.promise; return streamFor('au05'); } });
  f.voice.restore({ enabled: true, microphoneId: 'au05' }); const starting = f.voice.start(f.target); await entered.promise;
  f.voice.selectMicrophone('builtin'); gate.resolve();
  assert.equal(await starting, false); assert.equal(f.state.tracks[0].stops, 1); assert.equal(f.state.recorderStarts, 0);
  assert.equal(f.voice.snapshot().phase, 'ready'); assert.equal(f.voice.snapshot().microphoneId, 'builtin'); f.voice.dispose();
});

test('restore and cancel invalidate pending catalog or enumeration results without opening audio', async () => {
  const catalog = deferred(), entered = deferred();
  const f = fixture({ catalog: () => { entered.resolve(); return catalog.promise; } });
  f.voice.restore({ enabled: true }); const starting = f.voice.start(f.target); await entered.promise;
  f.voice.restore({ enabled: true, microphoneId: 'builtin' }); catalog.resolve({ ok: false, value: null });
  assert.equal(await starting, false); assert.equal(f.voice.snapshot().phase, 'ready'); assert.equal(f.voice.snapshot().error, null);
  assert.equal(f.state.constraints.length, 0); assert.equal(f.state.enumerateCalls, 0); f.voice.dispose();
  const enumeration = deferred(); const g = fixture({ enumerate: () => enumeration.promise });
  const refreshing = g.voice.refreshMicrophones(); g.voice.selectMicrophone('builtin'); enumeration.resolve(devices()); await refreshing;
  assert.equal(g.voice.snapshot().microphoneId, 'builtin'); assert.deepEqual(g.voice.snapshot().microphones, []); assert.equal(g.state.constraints.length, 0); g.voice.dispose();
});

test('selection change aborts transcription and rejects late text without editing the draft', async () => {
  const response = deferred(), uploaded = deferred(); let signal;
  const f = fixture({ transcribe(_request, value) { signal = value; uploaded.resolve(); return response.promise; } });
  f.voice.restore({ enabled: true, microphoneId: 'au05' }); await f.voice.start(f.target); const finishing = f.voice.finish(); await uploaded.promise;
  f.voice.selectMicrophone('builtin'); assert.equal(signal.aborted, true); response.resolve({ ok: true, value: { text: 'late' } });
  assert.equal(await finishing, false); assert.deepEqual(f.state.inserted, []); assert.equal(f.voice.snapshot().microphoneId, 'builtin'); f.voice.dispose();
});

test('devicechange during transcription aborts and rejects late text without falling back', async () => {
  const response = deferred(), uploaded = deferred(); let signal;
  const f = fixture({ transcribe(_request, value) { signal = value; uploaded.resolve(); return response.promise; } });
  f.voice.restore({ enabled: true, microphoneId: 'au05' }); await f.voice.start(f.target); const finishing = f.voice.finish(); await uploaded.promise;
  f.state.devices = devices().filter(item => item.deviceId !== 'au05'); f.media.emit('devicechange'); await tick();
  assert.equal(signal.aborted, true); response.resolve({ ok: true, value: { text: 'late' } });
  assert.equal(await finishing, false); assert.deepEqual(f.state.inserted, []); assert.equal(f.voice.snapshot().microphoneId, 'au05');
  assert.equal(f.voice.snapshot().error, 'voice_microphone_missing'); assert.equal(f.state.constraints.length, 1); f.voice.dispose();
});

test('cancel immediately after finish settles the old operation without stopping a later recording', async () => {
  const f = fixture(); f.voice.restore({ enabled: true, microphoneId: 'au05' }); await f.voice.start(f.target);
  const finishing = f.voice.finish(); f.voice.cancel();
  assert.equal(await f.voice.start(f.target), true); assert.equal(await finishing, false);
  assert.equal(f.state.tracks.at(-1).stops, 0); assert.equal(f.voice.snapshot().phase, 'recording'); assert.equal(f.state.uploads, 0); f.voice.dispose();
});

test('enumeration failures expose only fixed errors and never leak raw labels or exception text', async () => {
  const f = fixture({ enumerate() { throw new Error('raw sensitive device/label'); } });
  const result = await f.voice.refreshMicrophones(); assert.equal(result.microphoneError, 'voice_microphone_unavailable');
  assert.equal(result.error, 'voice_microphone_unavailable'); assert.equal(JSON.stringify(f.state.snapshots).includes('raw sensitive'), false);
  assert.equal(f.state.constraints.length, 0); f.voice.dispose();
});

test('each explicit enable revalidates catalog before requesting permission again', async () => {
  let configured = true;
  const f = fixture({ catalog() {
    return configured ? { ok: true, value: { selection: { providerId: 'local' },
      providers: [{ id: 'local', name: 'Local', preparation: { phase: 'ready' } }], maxAudioBytes: 10000, maxDurationSeconds: 10 } }
      : { ok: false, value: null };
  } });
  assert.equal(await f.voice.enable(), true); configured = false;
  assert.equal(await f.voice.enable(), false); assert.equal(f.state.catalogCalls, 2); assert.equal(f.state.constraints.length, 1);
  assert.equal(f.voice.snapshot().error, 'voice_not_configured'); f.voice.dispose();
});

test('older enumeration results cannot overwrite a newer missing-device result or resurrect recording', async () => {
  const old = deferred(), newer = deferred();
  const f = fixture({ enumerate(state) { return state.enumerateCalls === 1 ? old.promise : newer.promise; } });
  f.voice.restore({ enabled: true, microphoneId: 'au05' });
  const first = f.voice.refreshMicrophones(), second = f.voice.refreshMicrophones();
  newer.resolve(devices().filter(item => item.deviceId !== 'au05')); await second;
  old.resolve(devices()); await first;
  assert.equal(f.voice.snapshot().microphoneId, 'au05'); assert.equal(f.voice.snapshot().microphoneError, 'voice_microphone_missing');
  assert.equal(f.voice.snapshot().microphones.some(item => item.deviceId === 'au05'), false); assert.equal(f.state.constraints.length, 0); f.voice.dispose();
});

test('dispose during acquisition stops late tracks and suppresses all later callbacks and devicechange activity', async () => {
  const gate = deferred(), entered = deferred();
  const f = fixture({ async acquire(_constraints, _state, streamFor) { entered.resolve(); await gate.promise; return streamFor('au05'); } });
  f.voice.restore({ enabled: true, microphoneId: 'au05' }); const starting = f.voice.start(f.target); await entered.promise;
  f.voice.dispose(); const snapshots = f.state.snapshots.length; const enumerations = f.state.enumerateCalls;
  gate.resolve(); assert.equal(await starting, false); assert.equal(f.state.tracks[0].stops, 1);
  f.media.emit('devicechange'); await tick(); assert.equal(f.state.enumerateCalls, enumerations); assert.equal(f.state.snapshots.length, snapshots);
  assert.equal(f.voice.selectMicrophone('builtin'), false); assert.equal(f.state.recorderStarts, 0);
});
