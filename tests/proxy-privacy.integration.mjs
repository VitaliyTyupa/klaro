import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createDeploymentServer } from '../tools/serve-deployment.mjs';
test('reverse proxy forwards processing traffic without logging text, query, token or error body', async () => {
  const canary = 'PRIVATE-TEXT-CANARY'; const secret = 'SYNTHETIC-SECRET-CANARY'; const logs = [];
  const backend = createServer(async (request, response) => { let body = ''; for await (const chunk of request) body += chunk; assert.match(body, /PRIVATE-TEXT-CANARY/); assert.equal(request.headers.authorization, `Bearer ${secret}`); response.writeHead(503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ code: 'unavailable', retryable: true })); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const proxy = await createDeploymentServer({ upstream: `http://127.0.0.1:${backend.address().port}`, log: value => logs.push(value) }); proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  try { const response = await fetch(`http://127.0.0.1:${proxy.address().port}/v1/operations?input=${canary}`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: canary }); assert.equal(response.status, 503); await response.text(); assert.equal(JSON.stringify(logs).includes(canary), false); assert.equal(JSON.stringify(logs).includes(secret), false); assert.deepEqual(Object.keys(JSON.parse(logs[0])).sort(), ['durationMs','event','status']); }
  finally { proxy.closeAllConnections(); backend.closeAllConnections(); await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => backend.close(resolve))]); }
});
