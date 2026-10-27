// Official external-client lazy module format; no SDK internals are bundled.
// Observer only: explicit local connection; no session actions or device writes.
window.__ModuleLoader__.load({
  id: '@abworks/dsh-plugin-au05',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const events = new Set(['k1.down', 'k1.up', 'k2.down', 'k2.up', 'k3.down', 'k3.up',
      'knob.down', 'knob.up', 'right.pulse', 'left.pulse']);
    const endpoint = 'http://127.0.0.1:17376/v1/events';
    // The explicit connection belongs to one plugin instance, not a disposable composer view.
    // No credential persistence, background reconnect, or session-bound control capability.
    function createObserver() {
      let snapshot = { status: 'disconnected', sample: null, mounts: 0, detachments: 0 };
      let active = null, disposed = false;
      const listeners = new Set();
      const publish = update => {
        if (disposed) return;
        snapshot = { ...snapshot, ...update };
        for (const listener of listeners) listener();
      };
      const abort = () => { const previous = active; active = null; previous?.abort(); };
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        attach() { publish({ mounts: snapshot.mounts + 1 }); },
        detach() { publish({ detachments: snapshot.detachments + 1 }); },
        disconnect() { if (!disposed) { abort(); publish({ status: 'disconnected', sample: null }); } },
        dispose() { if (!disposed) { abort(); disposed = true; listeners.clear(); } },
        async connect(secret) {
          if (disposed) return;
          if (!/^[a-f0-9]{64}$/.test(secret)) {
            if (!active) publish({ status: 'invalid token' });
            return;
          }
          abort();
          const controller = new AbortController(); active = controller;
          const current = () => !disposed && active === controller && !controller.signal.aborted;
          publish({ status: 'connecting', sample: null });
          let reader;
          try {
            const response = await fetch(endpoint, { method: 'GET', headers: { Authorization: `Bearer ${secret}` },
              cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
            secret = null;
            if (!current()) return;
            if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body)
              throw new Error('observer_unavailable');
            reader = response.body.getReader();
            const decoder = new TextDecoder(); let buffer = '';
            while (current()) {
              const { value, done } = await reader.read();
              if (!current()) return;
              if (done) break;
              buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
              if (buffer.length > 65536) throw new Error('observer_frame_limit');
              let boundary;
              while ((boundary = buffer.indexOf('\n\n')) !== -1) {
                const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
                const kind = frame.match(/^event: *(snapshot|input|status)$/m)?.[1];
                const json = frame.match(/^data: *(.*)$/m)?.[1];
                if (!kind || !json) continue;
                const data = JSON.parse(json);
                if (data.readOnly !== true || data.writes !== 0 || typeof data.hardware !== 'boolean'
                  || typeof data.finished !== 'boolean' || !Number.isSafeInteger(data.sequence) || data.sequence < 0
                  || !data.counts || typeof data.counts !== 'object' || Array.isArray(data.counts)
                  || Object.entries(data.counts).some(([name, count]) => !events.has(name) || !Number.isSafeInteger(count) || count < 0)
                  || (kind === 'input' && !events.has(data.event))) throw new Error('observer_invalid_frame');
                if (!current()) return;
                publish({ sample: { sequence: data.sequence, lastEvent: events.has(data.event) ? data.event
                  : events.has(data.lastEvent) ? data.lastEvent : null, counts: data.counts },
                  status: data.finished ? 'capture finished' : data.hardware ? 'receiving (read-only)' : 'waiting for verified hardware' });
              }
            }
            if (current()) publish({ status: 'stream closed' });
          } catch {
            if (current()) publish({ status: 'unavailable (read-only)' });
          } finally {
            secret = null;
            if (reader) { try { await reader.cancel(); } catch {} reader.releaseLock(); }
            if (active === controller) active = null;
          }
        },
      };
    }
    function observerView(observer) {
      return function Au05Observer() {
        const [token, setToken] = React.useState('');
        const [snapshot, setSnapshot] = React.useState(observer.getSnapshot);
        React.useEffect(() => {
          const unsubscribe = observer.subscribe(() => setSnapshot(observer.getSnapshot()));
          observer.attach(); setSnapshot(observer.getSnapshot());
          return () => { unsubscribe(); observer.detach(); };
        }, []);
        const connect = () => { const secret = token; setToken(''); return observer.connect(secret); };
        const { status, sample, mounts, detachments } = snapshot;
        return h('div', { 'data-au05-observer': '', style: { fontSize: '12px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
          h('span', { 'data-au05-connection': '' }, `HID observer: ${status}`),
          h('input', { type: 'password', value: token, autoComplete: 'off', placeholder: 'Temporary observer token',
            'aria-label': 'AU05 temporary observer token', onChange: event => setToken(event.target.value), style: { width: '175px' } }),
          h('button', { type: 'button', onClick: connect }, 'Connect observer'),
          h('button', { type: 'button', onClick: () => observer.disconnect() }, 'Disconnect observer'),
          h('span', { 'data-au05-input': '' }, sample
            ? `event reports ${Object.values(sample.counts).reduce((sum, count) => sum + count, 0)} · sequence ${sample.sequence} · last ${sample.lastEvent ?? 'none'} · ${Object.entries(sample.counts).map(([name, count]) => `${name}:${count}`).join(' ')}`
            : 'No input observed'),
          h('span', { 'data-au05-lifecycle': '' }, `observer views ${mounts} · detachments ${detachments}`),
          h('span', null, 'No lights / send / cancel / approvals'));
      };
    }
    function Au05Preview(props) {
      const sessionId = props.sessionId;
      const state = props.useSessionStatus(statuses => sessionId === undefined ? undefined : statuses.get(sessionId));
      const label = !state ? 'unknown' : state.pendingInteraction?.kind === 'approval' ? 'approval'
        : state.pendingInteraction ? 'interaction' : state.running === true ? 'running'
        : state.running === false ? 'idle' : 'unknown';
      return h('div', { 'data-au05-plugin': '', style: { display: 'grid', gap: '4px' } },
        h('span', { role: 'status', title: 'Read-only session status. No input or approval action is executed.',
          style: { fontSize: '12px', opacity: 0.8 } }, `AU05 preview · ${label} · controls off`),
        h(props.Observer));
    }
    return {
      inject: ['slots', 'uiSession'],
      apply(ctx) {
        const observer = createObserver();
        const Observer = observerView(observer);
        ctx.effect(() => () => observer.dispose());
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'au05-preview', order: 90,
        }, props => Au05Preview({ ...props, Observer })));
      },
    };
  },
});
