import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { OidcService } from '../dist/api/identity/oidc.js';
import { startOidcProvider } from './oidc-provider.fixture.mjs';

const provider = await startOidcProvider();
const { issuer } = provider;
const callback = `${issuer}auth/callback`;
const binding = randomBytes(32).toString('base64url');
let now = Date.now();
const service = new OidcService({ issuer, clientId: 'klaro-test', callbacks: [callback], allowLoopbackHttp: true }, () => now);

async function flow() {
  const authorization = await service.begin(callback, binding);
  const response = await fetch(authorization, { redirect: 'manual' });
  assert.equal(response.status, 302);
  return new URL(response.headers.get('location'));
}

try {
  const first = await flow();
  assert.deepEqual(await service.complete(first, binding), { issuer, subject: 'synthetic-user' });
  assert.equal(provider.exchanges(), 1);
  await assert.rejects(service.complete(first, binding));
  assert.equal(provider.exchanges(), 1);
  for (const mode of ['issuer', 'audience', 'nonce']) { provider.setMode(mode); await assert.rejects(service.complete(await flow(), binding)); }
  provider.setMode('valid');
  await assert.rejects(service.begin(`${issuer}attacker`, binding));
  const changed = await flow();
  const changedUrl = new URL(changed);
  changedUrl.pathname = '/attacker';
  const before = provider.exchanges();
  await assert.rejects(service.complete(changedUrl, binding));
  await assert.rejects(service.complete(changed, 'wrong-browser'));
  assert.equal(provider.exchanges(), before);
  const expired = await flow();
  now += 300001;
  await assert.rejects(service.complete(expired, binding));
  assert.equal(provider.exchanges(), before);
  assert.throws(() => new OidcService({ issuer: 'http://example.com', clientId: 'test', callbacks: [callback], allowLoopbackHttp: true }));
  console.info('OIDC login, PKCE, replay, issuer, audience, nonce, callback, binding and expiry checks passed');
} finally {
  await provider.close();
}
