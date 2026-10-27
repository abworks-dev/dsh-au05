import { randomBytes } from 'node:crypto';
import { createBridge } from '../apps/bridge/server.mjs';
const token = randomBytes(32).toString('hex');
const server = createBridge({ token });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let lease;
async function post(path, data) {
  const response = await fetch(base + path, { method: 'POST', headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(lease ? { 'X-AU05-Lease': lease } : {}),
  }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
try {
  lease = (await post('/v1/lease', { owner: 'demo' })).id;
  console.log(await post('/v1/snapshot', { sessionId: 'demo-session', revision: 1, focused: true,
    running: true, completionUnread: false, pending: { kind: 'approval', key: 'demo-request', answerable: true } }));
  const { ticket } = await post('/v1/mock/input', { eventId: 'demo-k2-1', action: 'allow_once' });
  console.log(await post('/v1/mock/consume', { ticket }));
  console.log('PASS: simulated intent only; no DSH, HID, shell or approval was executed.');
} finally { await new Promise(resolve => server.close(resolve)); server.closeAllConnections(); }
