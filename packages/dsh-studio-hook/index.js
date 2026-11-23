import { createDshHookObserver } from './core.js';

export const inject = ['sessions', 'agents', 'typert', 'typertGateway'];

/** Explicitly enabled adapters; mounting alone never starts Studio publication. */
export function apply(ctx, config = {}) {
  if (config.enabled !== true) return;
  if (config.transport === 'studio') {
    if (!ctx?.sessions?.get || typeof ctx.on !== 'function' || !ctx.typert?.register || typeof ctx.effect !== 'function') throw new Error('studio_sender_not_verified');
    return Promise.all([import('@deepseek-ai/dsh-typert-protocol'), import('./rpc.js')])
      .then(([{ TypertRemoteService }, { mountStudioRuntime }]) => mountStudioRuntime(ctx, { TypertRemoteService }));
  }
  if (config.transport === 'verification') {
    const seconds = config.seconds ?? 120;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) throw new Error('invalid_observer_duration');
    return Promise.all([import('@deepseek-ai/dsh-typert-protocol'), import('./rpc.js')])
      .then(([{ TypertRemoteService }, { mountStudioVerifier }]) => mountStudioVerifier(ctx, { TypertRemoteService, seconds }));
  }
  if (config.transport !== 'dry-run-only') throw new Error('studio_sender_not_verified');
  const seconds = config.seconds ?? 60;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) throw new Error('invalid_observer_duration');
  const observer = createDshHookObserver({ sessionId: config.sessionId, sessions: ctx.sessions,
    emit: record => ctx.logger.info(JSON.stringify(record)) });
  const disposers = [];
  let closed = false, timer;
  const dispose = () => {
    if (closed) return; closed = true; clearTimeout(timer); observer.stop();
    for (const off of disposers.splice(0)) { try { off(); } catch {} }
  };
  try {
    for (const [name, listener] of Object.entries(observer.listeners)) disposers.push(ctx.on(name, listener));
    ctx.effect(() => dispose, 'dsh-studio-hook.cleanup');
    observer.attach(); timer = setTimeout(dispose, seconds * 1000); timer.unref?.();
  } catch (error) { dispose(); throw error; }
  return dispose;
}
