import { createDeviceProfile } from '../../core/device-profile.js';

// Match Ulanzi task lamps: 0=off, 1=solid, 2=breathing.
// Semantic feedback does not by itself establish task progress or recording.
export const au05Profile = createDeviceProfile({
  id: 'au05',
  inputs: ['k1.down', 'k1.up', 'k2.down', 'k2.up', 'k3.down', 'k3.up', 'knob.down', 'knob.up', 'right.pulse', 'left.pulse'],
  feedback: {
    channels: 4,
    maxValue: 2,
    states: { idle: [0, 0, 0, 0], running: [0, 0, 0, 1], approval: [0, 2, 0, 0], attention: [0, 0, 2, 0], recording: [2, 0, 0, 0] },
  },
});
