// Platform- and application-independent device wire capabilities. No I/O or discovery.
// A profile describes an already reviewed adapter, never grants operating permission.
export function createDeviceProfile({ id, inputs, feedback } = {}) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9.-]*$/.test(id)
    || !Array.isArray(inputs) || inputs.length === 0
    || Array.from(inputs).some(value => typeof value !== 'string' || !/^[a-z][a-z0-9.-]*$/.test(value))
    || new Set(inputs).size !== inputs.length) throw new TypeError('invalid_device_profile');
  const plain = value => value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  if (!plain(feedback) || !Number.isInteger(feedback.channels) || feedback.channels < 0 || feedback.channels > 256
    || !Number.isInteger(feedback.maxValue) || feedback.maxValue < 0 || feedback.maxValue > 255
    || !plain(feedback.states) || Object.keys(feedback.states).length === 0) throw new TypeError('invalid_device_profile');
  const count = feedback.channels, max = feedback.maxValue;
  const validatesChannels = value => Array.isArray(value) && value.length === count
    && Array.from({ length: count }, (_, index) => Object.hasOwn(value, index)
      && Number.isInteger(value[index]) && value[index] >= 0 && value[index] <= max).every(Boolean);
  const states = Object.create(null);
  for (const [state, channels] of Object.entries(feedback.states)) {
    if (!/^[a-z][a-z0-9.-]*$/.test(state) || !validatesChannels(channels)) throw new TypeError('invalid_device_profile');
    states[state] = Object.freeze([...channels]);
  }
  Object.freeze(states);
  const names = new Set(inputs);
  return Object.freeze({ id, inputs: Object.freeze([...inputs]),
    feedback: Object.freeze({ channels: count, maxValue: max, states }),
    acceptsInput: event => names.has(event),
    acceptsFeedback: state => typeof state === 'string' && Object.hasOwn(states, state),
    defaultChannels: state => Object.hasOwn(states, state) ? [...states[state]] : undefined,
    validatesChannels,
  });
}
