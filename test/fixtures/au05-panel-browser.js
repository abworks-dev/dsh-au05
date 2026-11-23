// Browser fixture: the production view runs unchanged except for its test-only export.
// All state is synthetic. No production controller, connection, media or storage is used.
window.mountAu05Visual = (state, initial = {}) => {
  let snapshot = {
    state: 'disconnected', connected: false, inputFeedback: {}, error: null, sessionState: '待命',
    autoConnect: false, autoConnectStatus: '', voiceMode: 'dsh', voicePreferenceEnabled: false,
    voicePreferencesSaved: true, customShortcut: 'RightAlt', shortcut: 'RightAlt', shortcutPreset: 'typeless',
    knobMode: 'sessions', lightsEnabled: true, lightResult: 'preserved', lightState: 'idle',
    lightBrightness: null, lightBrightnessSaved: true, keyFeedback: false, keyFeedbackSaved: true, lightError: null, canConfigureVoice: true,
    bageshuo: { state: 'stopped', error: null }, windowsVoiceState: { state: 'stopped', error: null, level: 0 },
    voice: { phase: 'disabled', enabled: false, preparing: false, error: null, microphoneError: null,
      microphoneId: null, microphones: [{ deviceId: 'test-au05', label: 'AU05 USB 麦克风' }], conflictText: '' },
  };
  if (state === 'connecting') snapshot.state = 'connecting';
  if (state === 'error') Object.assign(snapshot, { state: 'no_device', error: 'no_device',
    lightResult: 'failed', lightError: 'snapshot_unavailable', voicePreferencesSaved: false });
  if (['preparing', 'recording', 'transcribing'].includes(state)) {
    Object.assign(snapshot, { connected: true, state: 'ready', voicePreferenceEnabled: true });
    snapshot.voice = { ...snapshot.voice, enabled: true, phase: state === 'transcribing' ? state : 'recording',
      preparing: state === 'preparing', providerName: '测试转写', location: 'cloud' };
  }
  if (state === 'custom') snapshot.voiceMode = 'custom';
  if (state === 'conflict') snapshot.voice = { ...snapshot.voice, enabled: true, phase: 'error',
    conflictSessionId: 'review', conflictText: '请保留当前草稿。新的转写文本不能覆盖已有输入，需要先复制再处理。' };
  if (state === 'windows' || state === 'shortcut') {
    snapshot.voiceMode = state === 'windows' ? 'windows' : 'shortcut';
    snapshot.voicePreferenceEnabled = true;
    snapshot.voice = { ...snapshot.voice, enabled: true, phase: 'requested' };
  }
  if (state === 'studio') Object.assign(snapshot, { transport: 'studio', connected: true, state: 'ready' });
  snapshot = { ...snapshot, ...initial };
  const listeners = new Set();
  // Replace snapshots, as production does, so React cannot bail out on a mutated object.
  // Arrays publish synchronously in one browser task to exercise batched down/up renders.
  window.au05VisualPublications = [];
  window.publishAu05VisualSnapshot = updates => {
    for (const update of Array.isArray(updates) ? updates : [updates]) {
      snapshot = { ...snapshot, ...update };
      window.au05VisualPublications.push(snapshot);
      for (const listener of listeners) listener();
    }
  };
  const actions = window.au05VisualActions = [];
  const controller = { getSnapshot: () => snapshot, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    refreshMicrophones: () => { actions.push('refreshMicrophones'); },
    setKeyFeedback: value => { actions.push(`setKeyFeedback:${value}`); window.publishAu05VisualSnapshot({ keyFeedback: value }); } };
  for (const name of ['connect', 'disconnect', 'enableVoice', 'disableVoice', 'setVoiceMode', 'setShortcutPreset', 'clearVoiceConflict',
    'setAutoConnect', 'selectMicrophone', 'openVoiceSettings', 'setShortcut', 'setKnobMode', 'setLights', 'stageLightBrightness', 'setLightBrightness', 'clearLightBrightness']) {
    controller[name] = () => { actions.push(name); throw new Error(`unexpected_visual_action:${name}`); };
  }
  const plugin = window.visualModule.factory(name => { if (name !== 'react') throw new Error(name); return window.React; });
  const View = plugin.visualView(controller);
  window.ReactDOM.createRoot(document.getElementById('root')).render(window.React.createElement(View));
};
