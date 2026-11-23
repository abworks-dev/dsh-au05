// Shared only inside this Host process; does not claim Studio's external HID handle.
// Keep this tiny protocol identical in both independently installable packages.
const key = Symbol.for('abworks.au05.mode-lease.v1');
export function createModeLease(mode, registry = (globalThis[key] ??= new Map())) {
  if (!['direct', 'studio'].includes(mode) || !(registry instanceof Map)) throw new Error('invalid_mode_lease');
  const token = Symbol(mode);
  return {
    acquire() {
      const held = registry.get('device');
      if (held && held.token !== token) return false;
      registry.set('device', { mode, token });
      return true;
    },
    release() { if (registry.get('device')?.token === token) registry.delete('device'); },
    conflict() { const held = registry.get('device'); return Boolean(held && held.token !== token); },
  };
}
