// Official external-client lazy module format; no SDK internals are bundled.
// This milestone is READ ONLY. There is intentionally no network or approval execution.
window.__ModuleLoader__.load({
  id: '@abworks/dsh-plugin-au05',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    function Au05Preview(props) {
      // The slot's session binding is the sole target; never select the first session.
      const sessionId = props.sessionId;
      const state = props.useSessionStatus(statuses => sessionId === undefined ? undefined : statuses.get(sessionId));
      const label = !state ? 'unknown' : state.pendingInteraction?.kind === 'approval' ? 'approval'
        : state.pendingInteraction ? 'interaction' : state.running === true ? 'running'
        : state.running === false ? 'idle' : 'unknown';
      return h('span', { role: 'status', title: 'Read-only preview. No bridge, hardware or approvals are connected.',
        style: { fontSize: '12px', opacity: 0.8 } }, `AU05 preview · ${label} · HID off`);
    }
    return {
      inject: ['slots', 'uiSession'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'au05-preview', order: 90,
        }, Au05Preview));
      },
    };
  },
});
