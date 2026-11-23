import { fileURLToPath } from 'node:url';
import { au05Profile } from './au05-profile.js';

const script = fileURLToPath(new URL('../../native/au05.ps1', import.meta.url));
export const au05DeviceAdapter = Object.freeze({ profile: au05Profile, createLaunchSpec: createAu05LaunchSpec });
const allowedEnv = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'PATHEXT', 'USERPROFILE', 'ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA', 'APPDATA', 'PSModulePath'];

/** Describe the explicit Connect launch without opening a device or starting a process. */
export function createAu05LaunchSpec(sourceEnv = process.env) {
  const env = Object.fromEntries(allowedEnv.filter(name => typeof sourceEnv[name] === 'string').map(name => [name, sourceEnv[name]]));
  // Active input requires online/heartbeat even when lamp feedback is disabled.
  return {
    command: 'pwsh',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-Mode', 'Connect', '-EnableLights'],
    options: { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env },
  };
}
