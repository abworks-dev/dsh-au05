// Explicit Studio following plus opt-in shared actions; no native HID fallback or automatic microphone/approval answers.
window.__ModuleLoader__.load({ id: '@abworks/dsh-studio-hook', factory(require) {
  const React = require('react'), h = React.createElement;
  const { createStudioActions } = require('@abworks/dsh-plugin-au05');
  function selected(ctx) {
    try {
      const id = ctx.uiSession.current.getSnapshot()?.key;
      const mains = Object.values(ctx.sessions.list.getSnapshot().byId).filter(row => (row.retainedBy?.mainView ?? 0) > 0);
      const binding = id && ctx.sessions.binding(id);
      return mains.length === 1 && mains[0].id === id && binding ? { id, binding } : null;
    } catch { return null; }
  }
  const labels = { idle: '未启动', running: '运行中', stopped: '已停止', binding_lost: '会话变化已停止', error: '异常' };
  const empty = { state: 'idle', accepted: 0, completed: 0, dropped: 0, lastEvent: '', lastCode: '', remaining: 0 };
  function createManager(ctx) {
    const listeners = new Set();
    let run = null, pendingStop = null, controls = 0, revision = 0, disposed = false, status = empty, error = '', snapshot;
    let inputController = null, inputConnection = null, pairing = '', pairingError = '', pairingBusy = false;
    const approvals = new WeakMap(), configuredRuns = new WeakSet();
    const bindingsExample = JSON.stringify(['k1', 'k2', 'k3', 'knob'].map((control, index) => ({ control, actionid: '', key: `0_${index}` })), null, 2);
    let bindingsDraft = bindingsExample, bindingsError = '', configuring = false;
    async function configureInputBindings() {
      const target = run, connection = inputConnection;
      if (!target || !active(target) || !connection || connection.target !== target || configuring) return;
      let bindings;
      try {
        bindings = JSON.parse(bindingsDraft);
        const controls = new Set(), ids = new Set(), keys = new Set();
        if (!Array.isArray(bindings) || bindings.length < 1 || bindings.length > 4) throw new Error();
        for (const entry of bindings) {
          if (!entry || Object.keys(entry).sort().join(',') !== 'actionid,control,key' || !['k1', 'k2', 'k3', 'knob'].includes(entry.control)
            || typeof entry.actionid !== 'string' || !entry.actionid.trim() || !/^0_[0-3]$/.test(entry.key)
            || controls.has(entry.control) || ids.has(entry.actionid) || keys.has(entry.key)) throw new Error();
          controls.add(entry.control); ids.add(entry.actionid); keys.add(entry.key);
        }
      } catch { bindingsError = '请填写自有插件实际按键实例 ActionID 和槽位；空白示例不可保存。'; publish(); return; }
      configuring = true; bindingsError = ''; publish();
      try {
        await rawRpc('inputConfigure', { owner: target.owner, inputOwner: connection.inputOwner, bindings });
        if (!active(target) || inputConnection !== connection) return;
        configuredRuns.add(target);
      } catch { if (active(target) && inputConnection === connection) bindingsError = '确认绑定失败，请先读取自有插件实际发现的按键后重试。'; }
      finally { if (run === target && inputConnection === connection) { configuring = false; publish(); } }
    }
    function closeInput() {
      // disconnect enters synchronously, capturing the old run before it is cleared.
      void inputController?.disconnect().catch(() => {});
      if (run) configuredRuns.delete(run);
      inputConnection = null; pairing = ''; pairingError = ''; pairingBusy = false; configuring = false; bindingsError = '';
    }
    async function rawRpc(method, args, signal) {
      const response = await ctx.connection.rpc.call('/api', `studioRuntime/${method}`, { args }, signal);
      if (response?.ok !== true || !response.value || typeof response.value !== 'object') throw new Error('studio_input_unavailable');
      return response.value;
    }
    function active(target) { return !disposed && run === target && status.state === 'running' && matches(target); }
    async function inputRpc(method, args = {}, signal) {
      const target = run;
      const routes = { connect: 'inputConnect', poll: 'inputPoll', disconnect: 'inputDisconnect', windowsVoice: 'inputWindowsVoice', shortcutVoice: 'inputShortcutVoice' };
      if (!Object.hasOwn(routes, method)) throw new Error('studio_input_method_unavailable');
      // Runtime teardown already closes the Host bridge; local disposal needs no unknown status/native endpoint.
      if (method === 'disconnect' && (!target || !active(target) || !inputConnection)) return { state: 'disconnected', connected: false, generation: 0, sequence: 0, events: [] };
      if (!target || !active(target) || signal?.aborted) throw new Error('studio_runtime_not_running');
      if (method !== 'connect' && inputConnection?.target !== target) throw new Error('studio_input_not_connected');
      if (method !== 'connect' && inputConnection.inputOwner !== args.owner) throw new Error('studio_input_owner_mismatch');
      const value = await rawRpc(routes[method], { owner: target.owner, inputOwner: args.owner,
        ...(args.options ? { options: args.options } : {}), ...(args.gesture ? { gesture: args.gesture } : {}) }, signal);
      if (!active(target) || signal?.aborted) throw new Error('studio_input_obsolete');
      if (method === 'connect') { inputConnection = { target, inputOwner: args.owner }; configuredRuns.delete(target); pairing = ''; pairingError = ''; publish(); }
      if (method === 'disconnect' && inputConnection?.target === target && inputConnection.inputOwner === args.owner) { inputConnection = null; configuredRuns.delete(target); pairing = ''; configuring = false; pairingBusy = false; publish(); }
      return value;
    }
    async function readCandidates() {
      const target = run, connection = inputConnection;
      if (!target || !active(target) || !connection || connection.target !== target || configuring) return;
      configuring = true; bindingsError = ''; publish();
      try {
        const value = await rawRpc('inputCandidates', { owner: target.owner, inputOwner: connection.inputOwner });
        if (!active(target) || inputConnection !== connection) return;
        if (!Array.isArray(value)) throw new Error('invalid_candidates');
        bindingsDraft = JSON.stringify(value.map(entry => ({ control: entry.control, actionid: entry.actionid, key: entry.key })), null, 2);
      } catch { if (active(target) && inputConnection === connection) bindingsError = '读取已发现绑定失败，请确认自有插件已加载配对配置。'; }
      finally { if (run === target && inputConnection === connection) { configuring = false; publish(); } }
    }
    async function readPairing() {
      const target = run, connection = inputConnection;
      if (!target || !active(target) || !connection || connection.target !== target || pairingBusy) return;
      pairingBusy = true; pairing = ''; pairingError = ''; publish();
      try {
        const value = await rawRpc('inputPairing', { owner: target.owner, inputOwner: connection.inputOwner });
        if (!active(target) || inputConnection !== connection) return;
        pairing = JSON.stringify(value, null, 2);
      } catch {
        if (active(target) && inputConnection === connection) pairingError = '读取配对配置失败，请检查按键桥连接后重试。';
      } finally { if (run === target && inputConnection === connection) { pairingBusy = false; publish(); } }
    }
    function approvalCarrier(target) {
      if (!active(target)) return null;
      try {
        const store = ctx.uiSession.sessionStatus;
        if (typeof store?.getSnapshot !== 'function') return null;
        const pending = store.getSnapshot()?.get(target.sessionId)?.pendingInteraction;
        return pending?.kind === 'approval' && pending.answerable === true && pending.sessionId === target.sessionId
          && typeof pending.key === 'string' && pending.key.length > 0 && pending.key.length <= 256
          && typeof pending.answer === 'function' ? pending : null;
      } catch { return null; }
    }
    async function projectApproval() {
      const target = run;
      if (!target) return;
      const carrier = approvalCarrier(target);
      if (!carrier) return;
      const record = approvals.get(target);
      if (!record || record.pending || record.sent.has(carrier.key)) return;
      record.pending = true;
      const projection = { sessionId: target.sessionId, key: carrier.key, observedAt: Date.now(), revision: ++record.revision, answerable: true };
      try {
        // Only the public approval carrier is observed; no answer or input content crosses this boundary.
        if (approvalCarrier(target) !== carrier) return;
        const value = await rpc('approval', { owner: target.owner, projection });
        if (!active(target)) return;
        record.sent.add(carrier.key);
        if (approvalCarrier(target) !== carrier) return;
        status = value;
        if (value.state !== 'running') { closeInput(); run = null; }
        publish();
      } catch { /* Keep public state unchanged; poll may retry a transport failure. */ }
      finally { record.pending = false; }
    }
    const desktop = window.location.protocol === 'dsh-app:';
    const matches = target => { const next = selected(ctx); return next?.id === target.sessionId && next.binding === target.binding; };
    function publish() {
      snapshot = { status, error, bindingsDraft, bindingsError, configuring, bindingsConfigured: Boolean(run && configuredRuns.has(run)),
        canConfigure: Boolean(run && active(run) && inputConnection?.target === run && !configuring), pairing, pairingError, pairingBusy, canPair: Boolean(inputConnection && run && active(run)), busy: controls > 0, canStart: !disposed && desktop && !run && !pendingStop && controls === 0 && Boolean(selected(ctx)), canStop: !disposed && Boolean(run || pendingStop) && (!pendingStop || controls === 0) };
      for (const listener of listeners) listener();
    }
    async function rpc(method, args) {
      const response = await ctx.connection.rpc.call('/api', `studioRuntime/${method}`, { args });
      if (response?.ok === false) {
        const failure = new Error('runtime_rejected');
        failure.rejected = true;
        throw failure;
      }
      const value = response?.value;
      if (response?.ok !== true || !value || !Object.hasOwn(labels, value.state)) throw new Error('runtime_unavailable');
      return { state: value.state, accepted: Number(value.accepted) || 0, completed: Number(value.completed) || 0,
        dropped: Number(value.dropped) || 0, lastEvent: value.lastEvent, lastCode: value.lastCode, remaining: 0 };
    }
    async function stopOwner(target) {
      try {
        const value = await rpc('stop', { owner: target.owner });
        if (value.state === 'running' || value.state === 'error') throw new Error('stop_unconfirmed');
        if (pendingStop === target) pendingStop = null;
        return value;
      } catch {
        // Keep the immutable token for manual retry and final apply cleanup.
        if (!disposed) {
          if (!run || run === target) pendingStop = target;
          status = { ...status, state: 'error' };
          error = '停止请求未确认，请检查 Studio 连接后重试。'; publish();
        }
        return null;
      }
    }
    async function stop(reason = 'stopped') {
      const target = run ?? pendingStop;
      if (!target || (!run && controls)) return;
      closeInput(); run = null; pendingStop = target;
      const ticket = ++revision;
      controls++; status = { ...status, state: reason }; error = ''; publish();
      const value = await stopOwner(target);
      if (!disposed && revision === ticket) {
        status = { ...(value ?? status), state: value ? reason : 'error' };
      }
      controls--; if (!disposed) publish();
    }
    async function start() {
      if (disposed || !desktop || run || pendingStop || controls) return;
      const target = selected(ctx);
      if (!target) return;
      let owner;
      try { owner = crypto.randomUUID(); }
      catch { error = '无法建立安全连接，请重新打开桌面应用。'; status = { ...status, state: 'error' }; publish(); return; }
      const candidate = Object.freeze({ owner, sessionId: target.id, binding: target.binding });
      const ticket = ++revision;
      approvals.set(candidate, { revision: 0, sent: new Set(), pending: false });
      run = candidate; controls++; error = ''; publish();
      try {
        const value = await rpc('start', { sessionId: candidate.sessionId, owner: candidate.owner });
        if (disposed || run !== candidate || revision !== ticket || !matches(candidate)) {
          if (run === candidate) { run = null; revision++; status = { ...status, state: 'binding_lost' }; }
          // A stop can overtake an in-flight start. Stop again after its late reply.
          await stopOwner(candidate);
          return;
        }
        status = value;
        if (value.state !== 'running') { run = null; error = '未能开始跟随，请检查 Studio 或其他连接。'; }
        else void projectApproval();
      } catch (failure) {
        if (!disposed && run === candidate && revision === ticket) {
          run = null; status = { ...status, state: 'error' };
          error = '无法开始跟随：Studio 不可用或已有连接，请检查后重试。';
        }
        // Explicit server rejection guarantees this candidate was not left active.
        // Only ambiguous transport/malformed replies need a compensating stop.
        if (failure?.rejected === true) {
          if (pendingStop === candidate) pendingStop = null;
        } else await stopOwner(candidate);
      } finally { controls--; if (!disposed) publish(); }
    }
    let polling = null;
    async function poll() {
      const target = run;
      if (!target || controls || polling === target || disposed) return;
      if (!matches(target)) { await stop('binding_lost'); return; }
      polling = target;
      try {
        const value = await rpc('poll', { owner: target.owner });
        if (!disposed && run === target) {
          if (!matches(target)) { await stop('binding_lost'); return; }
          status = value;
          if (value.state !== 'running') { closeInput(); run = null; error = value.state === 'error' ? '跟随已中断，请检查 Studio 连接。' : ''; }
          publish();
          if (value.state === 'running') await projectApproval();
        }
      } catch {
        if (!disposed && run === target) {
          await stop('error');
          error = '跟随已中断，请检查 Studio 连接后重新开始。'; publish();
        }
      } finally { if (polling === target) polling = null; }
    }
    function changed() {
      if (disposed) return;
      if (run && !matches(run)) { void stop('binding_lost'); return; }
      publish();
      void projectApproval();
    }
    publish();
    return {
      getSnapshot: () => snapshot,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      start, stop, inputRpc, readPairing, readCandidates, configureInputBindings,
      setBindingsDraft(value) { if (!disposed && !configuring) { bindingsDraft = String(value); publish(); } },
      setInputController(controller) { inputController = controller; },
      mount() {
        const releaseCurrent = ctx.uiSession.current.subscribe(changed);
        const releaseList = ctx.sessions.list.subscribe(changed);
        const releaseStatus = ctx.uiSession.sessionStatus?.subscribe?.(changed);
        const timer = setInterval(poll, 1000);
        return () => {
          closeInput(); disposed = true; revision++;
          clearInterval(timer); releaseCurrent(); releaseList(); releaseStatus?.();
          const target = run ?? pendingStop; run = null; pendingStop = null;
          if (target) void stopOwner(target);
          publish(); listeners.clear();
        };
      },
    };
  }
  // `uiSession.sessionStatus` is a separate Cordis service since DSH 0.2.3; it must be injected by name.
  return { inject: ['slots', 'connection', 'sessions', 'uiSession', 'uiSession.sessionStatus', 'uiWorkspace', 'workspaces', 'remote'], apply(ctx) {
    const manager = createManager(ctx);
    const { controller, View: ActionsView } = createStudioActions(ctx, { rpc: manager.inputRpc });
    manager.setInputController(controller);
    ctx.effect(() => manager.mount());
    function StudioSettings() {
      const view = React.useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
      const { status } = view;
      return h('section', { 'data-studio-settings': '', 'aria-label': 'AU05 / Studio', style: { padding: '16px', maxWidth: '720px' } },
        h('h2', null, 'Studio协作模式'),
        h('p', null, 'Studio 必须保持运行；使用前请断开直连模式。'),
        h('p', null, '手动开始后持续跟随当前唯一主会话；关闭设置不会停止。切换会话后需重新开始。'),
        h('p', { role: 'status' }, `${labels[status.state] ?? '异常'} · 已转发 ${status.completed} · 已丢弃 ${status.dropped}`),
        h('button', { type: 'button', disabled: !view.canStart, onClick: manager.start }, '开始跟随当前会话'),
        ' ', h('button', { type: 'button', disabled: !view.canStop, onClick: () => manager.stop() }, '停止跟随'),
        !view.canStart && !view.canStop && h('p', null, window.location.protocol !== 'dsh-app:' ? '请在桌面应用中使用。' : view.busy ? '正在处理连接请求…' : '请先选中一个唯一主会话。'),
        h('p', null, 'K1录音灯关闭。开始跟随不会启动按键桥或麦克风；需单独连接按键桥并启用语音。'),
        h('p', null, '审批仅投影当前真实可回答状态。已转发不代表实体灯已确认。'),
        h('h3', null, '自有插件按键绑定'),
        h('p', null, '先连接按键桥，再显式读取配对配置并写入自有插件的 bridge.json。以下空白仅为未验证示例；插件加载配置后，读取实际发现的按键实例 ActionID 并逐项确认，不可使用清单 UUID 或私人历史记录。'),
        h('p', null, '先配对并确认绑定，未确认不会执行按键；Task 模式三键硬件尚待验证。每次重新连接均需重新确认。'),
        h('button', { type: 'button', disabled: !view.canConfigure, onClick: manager.readCandidates }, '读取已发现绑定'),
        h('textarea', { value: view.bindingsDraft, rows: 10, 'aria-label': '按键绑定 JSON', onChange: event => manager.setBindingsDraft(event.target.value), style: { width: '100%' } }),
        h('button', { type: 'button', disabled: !view.canConfigure, onClick: manager.configureInputBindings }, '确认这些按键绑定'),
        view.bindingsConfigured && h('p', { role: 'status' }, '本次跟随绑定已保存（不代表按键桥或实体设备已连接）'),
        view.bindingsError && h('p', { role: 'alert' }, view.bindingsError),
        h(ActionsView),
        h('button', { type: 'button', disabled: !view.canPair || view.pairingBusy, onClick: manager.readPairing }, '读取按键配对配置'),
        h('p', null, '仅在显式读取后显示配对密钥。请将配置写入已安装桥服务目录中的 bridge.json，勿发布或粘贴到日志。'),
        view.pairing && h('textarea', { readOnly: true, value: view.pairing, rows: 10, 'aria-label': '按键配对配置', style: { width: '100%' } }),
        view.pairingError && h('p', { role: 'alert' }, view.pairingError),
        view.error && h('p', { role: 'alert' }, view.error));
    }
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: 'au05-studio', order: 90, label: () => 'AU05 / Studio',
    }, StudioSettings));
  } };
} });
