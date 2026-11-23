import { mountAu05Host } from './host/rpc.js';

export const inject = ['typert', 'typertGateway'];

/** The official Host runtime supplies Remote services; import/activation never opens HID. */
export async function apply(ctx) {
  const { TypertRemoteService } = await import('@deepseek-ai/dsh-typert-protocol');
  return mountAu05Host(ctx, { TypertRemoteService });
}
