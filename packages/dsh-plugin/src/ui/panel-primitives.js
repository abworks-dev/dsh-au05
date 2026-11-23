// Presentation-only factories for the single-file client; no controller or effects.
// Call directly so native DOM shape, refs and event bindings remain unchanged.
/**
 * @param {Function} h React.createElement supplied by the host.
 * @returns {{ Field: Function, FieldActions: Function, Actions: Function }}
 */
export function createPanelUi(h) {
  const classes = (base, extra) => extra ? `${base} ${extra}` : base;
  return {
    /** Label and control must share htmlFor/id; following actions stay in column 2. */
    Field(props, ...children) {
      return h('div', { ...props, className: classes('au05-field', props?.className) }, ...children);
    },
    /** Secondary actions belong to the preceding field, not the next field. */
    FieldActions(props, ...children) {
      return h('div', { ...props, className: classes('au05-field-actions', props?.className) }, ...children);
    },
    /** Independent actions can wrap; connection actions retain their dedicated grid. */
    Actions(props, ...children) {
      return h('div', { ...props, className: classes('au05-actions', props?.className) }, ...children);
    },
  };
}
