/** Evidence/capability metadata only. No transport, device probing or recording inference. */
const DIRECT = Object.freeze({
  path: 'work-record-channel-0',
  configurationSupported: true,
  physicalVerified: false,
  requiresOptIn: true,
  status: 'configuration_only',
  reason: 'k1_physical_control_unverified',
});
const STUDIO = Object.freeze({
  path: null,
  configurationSupported: false,
  physicalVerified: false,
  requiresOptIn: true,
  status: 'unsupported',
  reason: 'studio_task_hooks_have_no_k1_control',
});

/** GET readback never upgrades this capability into a physical-appearance claim. */
export function k1LampCapability(mode = 'direct') {
  if (mode === 'direct') return { ...DIRECT };
  if (mode === 'studio') return { ...STUDIO };
  throw new Error('invalid_k1_mode');
}
