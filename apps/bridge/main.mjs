import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createBridge } from './server.mjs';

const token = randomBytes(32).toString('hex');
const origins = (process.env.AU05_ORIGINS ?? 'http://127.0.0.1:3080').split(',');
const port = Number(process.env.AU05_PORT ?? 17375);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid_port');
await mkdir('.local', { recursive: true });
await writeFile('.local/bridge-token', token, { mode: 0o600 });
const server = createBridge({ token, origins });
server.on('error', error => { console.error(error.code ?? 'bridge_error'); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`AU05 MOCK ONLY: http://127.0.0.1:${port}; token file .local/bridge-token (never commit).`);
  console.log('No hardware, no DSH approval execution. Windows token-file ACL must be reviewed.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
