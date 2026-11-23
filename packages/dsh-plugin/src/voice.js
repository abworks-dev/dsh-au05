// Inlined into the browser client by scripts/build-plugin.mjs; no extra runtime dependency.
export function createVoiceAdapter({ speech, onChange = () => {}, isCurrent = () => false,
  media = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder,
  Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext } = {}) {
  let enabled = false, phase = 'disabled', error = null, provider = null, language = null;
  let maxBytes = 4 * 1024 * 1024, maxSeconds = 120, epoch = 0, disposed = false;
  let microphoneId = null, microphones = [], microphoneError = null, microphonesKnown = false;
  let preparing = false, enumeration = 0, trackListeners = [];
  let stream = null, recorder = null, audio = null, timer = null, target = null, insertion = null;
  let chunks = [], chunkBytes = 0, stopped = null, releaseStop = null, finishPromise = null, controller = null, conflictText = '';
  const microphoneErrors = ['voice_microphone_missing', 'voice_microphone_mismatch', 'voice_microphone_unavailable', 'voice_microphone_denied'];
  const snapshot = () => ({ enabled, phase, error, providerName: provider?.name ?? '', location: provider?.location ?? null, conflictText,
    microphoneId, microphones: microphones.map(item => ({ ...item })), microphoneError,
    ready: enabled && phase === 'ready' && !microphoneError, preparing, prepared: provider !== null });
  const publish = () => { if (!disposed) onChange(snapshot()); };
  const stopTracks = value => { for (const track of value?.getTracks?.() ?? []) { try { track.stop(); } catch {} } };
  const detachTracks = () => { for (const remove of trackListeners) remove(); trackListeners = []; };
  const cleanRecording = () => {
    clearTimeout(timer); timer = null; detachTracks();
    if (recorder) { recorder.ondataavailable = null; recorder.onerror = null; recorder.onstop = null;
      if (recorder.state !== 'inactive') { try { recorder.stop(); } catch {} } }
    releaseStop?.(); releaseStop = null;
    recorder = null; stopTracks(stream); stream = null; chunks = []; chunkBytes = 0; stopped = null;
    if (audio) { try { void Promise.resolve(audio.close()).catch(() => {}); } catch {} audio = null; }
  };
  const cancel = () => {
    epoch++; enumeration++; controller?.abort(); controller = null; cleanRecording(); target = null; insertion = null;
    finishPromise = null; preparing = false; phase = enabled ? (microphoneError ? 'error' : 'ready') : 'disabled';
    error = microphoneError; conflictText = ''; publish();
  };
  const fail = code => {
    if (microphoneErrors.includes(code)) microphoneError = code;
    cancel(); phase = 'error'; error = code; publish();
  };
  const valid = generation => !disposed && epoch === generation;
  const current = generation => valid(generation) && enabled && target !== null && isCurrent(target);
  const ok = result => result?.ok === true && result.value !== null && typeof result.value === 'object';
  const supported = () => speech?.catalog && speech?.transcribe && media?.getUserMedia && Recorder && Audio;
  const concrete = id => id !== null && id !== 'default';
  const constraints = recording => ({ audio: { channelCount: 1, ...(recording ? { sampleRate: 16000 } : {}), echoCancellation: true,
    ...(microphoneId !== null ? { deviceId: { exact: microphoneId } } : {}) }, video: false });
  const audioTracks = value => value?.getAudioTracks?.() ?? value?.getTracks?.() ?? [];
  const trackDeviceId = value => {
    for (const track of audioTracks(value)) { try { const id = track.getSettings?.().deviceId; if (typeof id === 'string' && id) return id; } catch {} }
    return null;
  };
  const verifyStream = (value, selectedId) => {
    for (const track of audioTracks(value)) {
      if (track.readyState === 'ended') throw new Error('voice_microphone_missing');
      let id; try { id = track.getSettings?.().deviceId; } catch {}
      // The OS-default alias resolves to a physical ID; only physical selections can be compared literally.
      if (concrete(selectedId) && id && id !== selectedId) throw new Error('voice_microphone_mismatch');
    }
  };
  const mediaFailure = (failure, fallback) => microphoneErrors.includes(failure?.message) ? failure.message
    : ['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(failure?.name) ? 'voice_microphone_missing'
      : ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(failure?.name) ? 'voice_microphone_denied' : fallback;
  const selectionError = () => !media?.enumerateDevices
    ? (microphoneId === null ? null : 'voice_microphone_unavailable')
    : microphonesKnown && microphoneId !== null && !microphones.some(item => item.deviceId === microphoneId) ? 'voice_microphone_missing' : null;
  const autoMicrophone = (devices, actualId) => {
    const physical = devices.filter(item => item.deviceId && !['default', 'communications'].includes(item.deviceId));
    const preferred = physical.find(item => /(?:^|[^a-z0-9])au[\s_-]?05(?:[^a-z0-9]|$)/i.test(item.label));
    if (preferred) return preferred.deviceId;
    const actual = physical.find(item => item.deviceId === actualId);
    if (actual) return actual.deviceId;
    const system = devices.find(item => item.deviceId === 'default');
    // Do not pin a blank-label pre-permission catalog before AU05 can be recognized.
    const resolved = system?.label && physical.find(item => item.label && ((system.groupId && item.groupId === system.groupId)
      || system.label === item.label || system.label.endsWith(` - ${item.label}`)));
    return resolved?.deviceId ?? null;
  };
  const loadMicrophones = async (generation, { actualId = null, owned = false } = {}) => {
    const request = ++enumeration;
    if (!media?.enumerateDevices) {
      microphones = []; microphonesKnown = false; microphoneError = selectionError(); publish();
      if (microphoneError) throw new Error(microphoneError);
      return true;
    }
    let devices;
    try { devices = await media.enumerateDevices(); }
    catch { if (valid(generation) && request === enumeration) throw new Error('voice_microphone_unavailable'); return false; }
    if (!valid(generation) || request !== enumeration) return false;
    devices = Array.from(devices ?? []).filter(item => item.kind === 'audioinput' && typeof item.deviceId === 'string' && item.deviceId);
    microphones = devices.map(item => ({ deviceId: item.deviceId, label: typeof item.label === 'string' ? item.label : '' }));
    microphonesKnown = true;
    if (microphoneId === null) {
      const selected = autoMicrophone(devices, actualId);
      if (selected !== null) { microphoneId = selected; if (!owned && target !== null) cancel(); }
    }
    microphoneError = selectionError();
    if (microphoneError) { fail(microphoneError); return false; }
    if (microphoneErrors.includes(error)) { error = null; if (enabled && phase === 'error') phase = 'ready'; }
    publish(); return true;
  };
  const prepareCatalog = async generation => {
    if (provider) return true;
    const catalog = await speech.catalog();
    if (!valid(generation)) return false;
    if (!ok(catalog)) throw new Error('voice_not_configured');
    const selected = catalog.value.providers?.find(item => item.id === catalog.value.selection?.providerId);
    if (!selected || !['ready', 'standby', 'waking'].includes(selected.preparation?.phase)) throw new Error('voice_not_configured');
    if (!Number.isSafeInteger(catalog.value.maxAudioBytes) || catalog.value.maxAudioBytes < 46
      || !Number.isFinite(catalog.value.maxDurationSeconds) || catalog.value.maxDurationSeconds <= 0) throw new Error('voice_invalid_catalog');
    provider = { id: selected.id, name: selected.name, location: selected.location };
    language = catalog.value.selection.language;
    maxBytes = Math.min(catalog.value.maxAudioBytes, 4 * 1024 * 1024);
    maxSeconds = Math.min(catalog.value.maxDurationSeconds, 120, (maxBytes - 44) / 32000);
    return true;
  };
  const preparationFailure = (failure, fallback) => ['voice_not_configured', 'voice_invalid_catalog'].includes(failure?.message)
    ? failure.message : mediaFailure(failure, fallback);
  const api = {
    snapshot,
    // Settings hydration is deliberately synchronous and does not probe any browser or speech API.
    restore({ enabled: desired = false, microphoneId: selected = null } = {}) {
      if (disposed) return snapshot();
      enabled = desired === true; microphoneId = typeof selected === 'string' && selected ? selected : null;
      microphones = []; microphonesKnown = false; microphoneError = null; provider = null; language = null;
      cancel(); return snapshot();
    },
    async refreshMicrophones() {
      if (disposed) return snapshot();
      const generation = epoch;
      try { await loadMicrophones(generation); }
      catch (failure) { if (valid(generation)) fail(mediaFailure(failure, 'voice_microphone_unavailable')); }
      return snapshot();
    },
    selectMicrophone(deviceId) {
      if (disposed || (deviceId !== null && (typeof deviceId !== 'string' || !deviceId))) return false;
      if (microphoneId === deviceId) return true;
      microphoneId = deviceId; microphoneError = selectionError(); cancel(); return true;
    },
    async enable() {
      if (disposed) return false;
      enabled = false; cancel(); provider = null; language = null; const generation = epoch;
      if (!supported()) { fail('voice_unavailable'); return false; }
      preparing = true; publish();
      let permissionStream;
      try {
        if (!await prepareCatalog(generation) || !await loadMicrophones(generation, { owned: true })) return false;
        if (!valid(generation)) return false;
        const selectedId = microphoneId;
        permissionStream = await media.getUserMedia(constraints(false));
        if (!valid(generation)) return false;
        verifyStream(permissionStream, selectedId);
        const actualId = trackDeviceId(permissionStream);
        stopTracks(permissionStream); permissionStream = null;
        // Permission unlocks labels. Prefer AU05 once, then keep the chosen physical ID pinned.
        if (!await loadMicrophones(generation, { actualId, owned: true }) || !valid(generation)) return false;
        enabled = true; preparing = false; phase = 'ready'; error = null; microphoneError = null; publish(); return true;
      } catch (failure) {
        if (!valid(generation)) return false;
        enabled = false; fail(preparationFailure(failure, 'voice_microphone_denied')); return false;
      } finally {
        stopTracks(permissionStream);
        if (valid(generation)) { preparing = false; publish(); }
      }
    },
    disable() { enabled = false; cancel(); provider = null; language = null; publish(); },
    cancel,
    async start(value) {
      if (disposed || !enabled || !['ready', 'error'].includes(phase) || conflictText || !isCurrent(value)
        || !value?.inputActions?.captureInsertion || !value?.inputActions?.insertText) return false;
      cancel(); target = value; const generation = epoch;
      try { insertion = target.inputActions.captureInsertion(); } catch { fail('voice_insertion_unavailable'); return false; }
      if (!supported()) { fail('voice_unavailable'); return false; }
      phase = 'recording'; preparing = true; publish();
      let acquired;
      try {
        if (!await prepareCatalog(generation) || !current(generation)) return false;
        if (!await loadMicrophones(generation, { owned: true }) || !current(generation)) return false;
        let selectedId = microphoneId;
        acquired = await media.getUserMedia(constraints(true));
        if (!current(generation) || phase !== 'recording') return false;
        verifyStream(acquired, selectedId);
        if (selectedId === null && media?.enumerateDevices) {
          if (!await loadMicrophones(generation, { actualId: trackDeviceId(acquired), owned: true }) || !current(generation)) return false;
          // A restored first-use start may unlock AU05 labels on its first acquisition. Never record a different input under the pinned ID.
          if (microphoneId !== null && trackDeviceId(acquired) !== microphoneId) {
            stopTracks(acquired); acquired = null; selectedId = microphoneId;
            acquired = await media.getUserMedia(constraints(true));
            if (!current(generation) || phase !== 'recording') return false;
            verifyStream(acquired, selectedId);
          }
        }
        stream = acquired; acquired = null;
        for (const track of audioTracks(stream)) {
          const ended = () => { if (current(generation)) fail('voice_microphone_missing'); };
          if (track.addEventListener) { track.addEventListener('ended', ended); trackListeners.push(() => track.removeEventListener?.('ended', ended)); }
          else { const previous = track.onended; track.onended = ended; trackListeners.push(() => { if (track.onended === ended) track.onended = previous; }); }
        }
        recorder = new Recorder(stream);
        stopped = new Promise((resolveStop, rejectStop) => {
          releaseStop = resolveStop; recorder.onstop = resolveStop;
          recorder.onerror = () => rejectStop(new Error('voice_recording_failed'));
        });
        // Recording errors may precede key release; retain rejection for finish without an unhandled promise.
        stopped.catch(() => { if (current(generation)) fail('voice_recording_failed'); });
        recorder.ondataavailable = event => {
          if (!current(generation) || !event.data?.size) return;
          chunkBytes += event.data.size;
          if (chunkBytes > maxBytes) { fail('voice_audio_limit'); return; }
          chunks.push(event.data);
        };
        recorder.start(250); preparing = false; publish();
        timer = setTimeout(() => { if (current(generation)) fail('voice_duration_limit'); }, maxSeconds * 1000);
        return true;
      } catch (failure) {
        if (current(generation)) fail(preparationFailure(failure, 'voice_recording_failed'));
        return false;
      } finally {
        stopTracks(acquired);
        if (valid(generation) && preparing) { preparing = false; cancel(); }
      }
    },
    finish() {
      if (finishPromise) return finishPromise;
      if (disposed || phase !== 'recording') return Promise.resolve(false);
      if (!recorder || !target || !isCurrent(target)) { cancel(); return Promise.resolve(false); }
      const generation = epoch, capturedTarget = target, capturedInsertion = insertion, stopPromise = stopped;
      clearTimeout(timer); timer = null;
      phase = 'transcribing'; publish();
      finishPromise = (async () => {
        try {
          recorder.stop(); await stopPromise;
          if (!current(generation)) return false;
          detachTracks(); stopTracks(stream); stream = null; recorder = null; releaseStop = null;
          const blob = new Blob(chunks); chunks = [];
          if (!blob.size) throw new Error('voice_empty_audio');
          const decodingAudio = new Audio(); audio = decodingAudio;
          const decoded = await decodingAudio.decodeAudioData(await blob.arrayBuffer());
          if (!current(generation)) return false;
          const samples = Math.floor(decoded.duration * 16000);
          if (samples < 1 || decoded.duration > maxSeconds + 0.1 || 44 + samples * 2 > maxBytes) throw new Error('voice_audio_limit');
          const wave = new ArrayBuffer(44 + samples * 2), view = new DataView(wave);
          const ascii = (offset, text) => { for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index)); };
          ascii(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
          view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
          view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
          ascii(36, 'data'); view.setUint32(40, samples * 2, true);
          const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
          for (let index = 0; index < samples; index++) {
            const position = index * decoded.sampleRate / 16000, first = Math.min(Math.floor(position), decoded.length - 1), second = Math.min(first + 1, decoded.length - 1);
            const fraction = position - first;
            let value = 0;
            for (const channel of channels) value += channel[first] * (1 - fraction) + channel[second] * fraction;
            value = Math.max(-1, Math.min(1, value / channels.length));
            view.setInt16(44 + index * 2, value < 0 ? Math.round(value * 32768) : Math.round(value * 32767), true);
          }
          await decodingAudio.close(); if (audio === decodingAudio) audio = null;
          if (!current(generation)) return false;
          const bytes = new Uint8Array(wave); let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
          controller = new AbortController();
          const result = await speech.transcribe({ audioBase64: btoa(binary), providerId: provider.id, ...(language ? { language } : {}) }, controller.signal);
          if (!current(generation)) return false;
          if (!ok(result) || typeof result.value.text !== 'string' || !result.value.text.trim()) throw new Error('voice_transcription_failed');
          if (result.value.text.length > 100000) throw new Error('voice_text_limit');
          const inserted = capturedTarget.inputActions.insertText(result.value.text, capturedInsertion);
          if (inserted !== true) { conflictText = result.value.text; phase = 'error'; error = 'voice_draft_changed'; publish(); return false; }
          phase = 'ready'; error = null; publish(); return true;
        } catch (failure) {
          if (!current(generation)) return false;
          phase = 'error'; error = ['voice_empty_audio', 'voice_audio_limit', 'voice_text_limit'].includes(failure?.message) ? failure.message : 'voice_transcription_failed';
          publish(); return false;
        } finally {
          if (epoch === generation) { cleanRecording(); controller = null; target = null; insertion = null; finishPromise = null; }
        }
      })();
      return finishPromise;
    },
    dispose() { if (!disposed) { enabled = false; cancel(); media?.removeEventListener?.('devicechange', deviceChange); disposed = true; } },
  };
  const deviceChange = () => { if (!disposed && enabled) void api.refreshMicrophones(); };
  media?.addEventListener?.('devicechange', deviceChange);
  return api;
}
