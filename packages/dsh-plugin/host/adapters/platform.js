import { WindowsVoiceBridge } from '../windows-voice.js';
import { ShortcutVoiceBridge } from '../shortcut-voice.js';
import { WindowsVoiceStateObserver } from '../windows-voice-state.js';
import { BageshuoStateObserver } from '../bageshuo-state.js';
import { NativeWheelBridge } from '../native-wheel.js';
import { performance } from 'node:perf_hooks';

/** Construction only: bridge start/stop and device ownership remain with the coordinator. */
export function createPlatformAdapters({ platform = process.platform, now = Date.now,
  monotonicNow = () => performance.now(), schedule = setTimeout, cancel = clearTimeout } = {}) {
  return {
    createNativeWheelBridge: () => new NativeWheelBridge({ platform, now }),
    createWindowsVoiceBridge: () => new WindowsVoiceBridge({ platform, now }),
    createShortcutVoiceBridge: () => new ShortcutVoiceBridge({ platform, now }),
    createBageshuoStateObserver: onChange => new BageshuoStateObserver({ platform, now: monotonicNow, wallNow: now, schedule, cancelTimer: cancel, onChange }),
    createWindowsVoiceStateObserver: onChange => new WindowsVoiceStateObserver({ platform, now, schedule, cancelTimer: cancel, onChange }),
  };
}
