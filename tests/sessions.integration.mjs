import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import pg from 'pg';
import { startOidcProvider } from './oidc-provider.fixture.mjs';

const provider = await startOidcProvider();
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const appOrigin = 'https://klaro.test';
const api = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['dist/api/main.js'], { env: { ...process.env, NODE_ENV: 'test', PORT: String(port), APP_ORIGIN: appOrigin, OIDC_ISSUER: provider.issuer, OIDC_CLIENT_ID: 'klaro-test', OIDC_ALLOW_LOOPBACK_HTTP: 'true', EXTENSION_CALLBACKS: 'https://synthetic.chromiumapp.org/klaro' }, stdio: 'ignore' });
const database = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro' });
await database.connect();
const jar = cookies => cookies.map(cookie => cookie.split(';')[0]).join('; ');

async function login() {
  const start = await fetch(`${api}/auth/login`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const binding = jar(start.headers.getSetCookie());
  const providerResponse = await fetch(start.headers.get('location'), { redirect: 'manual' });
  assert.equal(providerResponse.status, 302);
  const callback = new URL(providerResponse.headers.get('location'));
  const complete = await fetch(`${api}${callback.pathname}${callback.search}`, { headers: { Cookie: binding }, redirect: 'manual' });
  assert.equal(complete.status, 302);
  assert.equal(complete.headers.get('location'), appOrigin);
  const cookies = complete.headers.getSetCookie();
  const sessionCookie = cookies.find(cookie => cookie.startsWith('__Host-klaro_session='));
  const csrfCookie = cookies.find(cookie => cookie.startsWith('__Host-klaro_csrf='));
  assert.ok(sessionCookie);
  for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/']) assert.ok(sessionCookie.includes(flag));
  assert.ok(csrfCookie.includes('Secure'));
  assert.ok(!csrfCookie.includes('HttpOnly'));
  assert.equal(complete.headers.get('cache-control'), 'no-store');
  const cookie = jar(cookies);
  const csrf = csrfCookie.split(';')[0].split('=')[1];
  const replay = await fetch(`${api}${callback.pathname}${callback.search}`, { headers: { Cookie: binding }, redirect: 'manual' });
  assert.equal(replay.status, 401);
  return { cookie, csrf };
}

try {
  let ready = false;
  for (let index = 0; index < 50; index++) {
    if (child.exitCode !== null) throw new Error('Test API exited');
    try { ready = (await fetch(`${api}/health`)).ok; } catch { /* Wait for startup. */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  assert.equal((await fetch(`${api}/auth/session`)).status, 401);
  const first = await login();
  const current = await fetch(`${api}/auth/session`, { headers: { Cookie: first.cookie } });
  assert.equal(current.status, 200);
  const { userId } = await current.json();
  const preferencesRequest = (cookie, body, csrf) => fetch(`${api}/v1/me/preferences`, { method: body ? 'PUT' : 'GET', headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json', Origin: appOrigin, 'X-CSRF-Token': csrf } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const defaults = { version: 'v1', nativeLanguage: 'uk', writingLanguages: ['de'], activeWritingLanguage: 'de', style: 'neutral', proficiency: null };
  assert.deepEqual(await (await preferencesRequest(first.cookie)).json(), defaults);
  const updatedPreferences = { ...defaults, nativeLanguage: 'vi', writingLanguages: ['en', 'de'], activeWritingLanguage: 'en', style: 'formal', proficiency: 'B2' };
  assert.equal((await preferencesRequest(first.cookie, updatedPreferences, first.csrf)).status, 200);
  assert.deepEqual(await (await preferencesRequest(first.cookie)).json(), updatedPreferences);
  assert.equal((await preferencesRequest(first.cookie, { ...defaults, nativeLanguage: 'de' }, first.csrf)).status, 400);
  assert.equal((await preferencesRequest(first.cookie, { ...updatedPreferences, userId: 'other-account' }, first.csrf)).status, 400);
  provider.setSubject('synthetic-second-user');
  const other = await login();
  assert.deepEqual(await (await preferencesRequest(other.cookie)).json(), defaults);
  assert.deepEqual(await (await preferencesRequest(first.cookie)).json(), updatedPreferences);
  provider.setSubject('synthetic-user');
  assert.equal((await fetch(`${api}/auth/logout`, { method: 'POST', headers: { Cookie: first.cookie } })).status, 403);
  assert.equal((await fetch(`${api}/auth/logout`, { method: 'POST', headers: { Cookie: first.cookie, Origin: 'https://attacker.test', 'X-CSRF-Token': first.csrf } })).status, 403);
  assert.equal((await fetch(`${api}/auth/logout`, { method: 'POST', headers: { Cookie: first.cookie, Origin: appOrigin, 'X-CSRF-Token': first.csrf } })).status, 204);
  assert.equal((await fetch(`${api}/auth/session`, { headers: { Cookie: first.cookie } })).status, 401);
  const second = await login();
  await database.query("UPDATE klaro.sessions SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
  assert.equal((await fetch(`${api}/auth/session`, { headers: { Cookie: second.cookie } })).status, 401);
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirect = 'https://synthetic.chromiumapp.org/klaro';
  assert.equal((await fetch(`${api}/auth/extension/login?redirectUri=https://attacker.test&codeChallenge=${challenge}`, { redirect: 'manual' })).status, 403);
  const extensionStart = await fetch(`${api}/auth/extension/login?redirectUri=${encodeURIComponent(redirect)}&codeChallenge=${challenge}`, { redirect: 'manual' });
  assert.equal(extensionStart.status, 302);
  const extensionProvider = await fetch(extensionStart.headers.get('location'), { redirect: 'manual' });
  const extensionCallback = new URL(extensionProvider.headers.get('location'));
  const extensionComplete = await fetch(`${api}${extensionCallback.pathname}${extensionCallback.search}`, { headers: { Cookie: jar(extensionStart.headers.getSetCookie()) }, redirect: 'manual' });
  assert.equal(extensionComplete.status, 302);
  const handoffUrl = new URL(extensionComplete.headers.get('location'));
  assert.equal(`${handoffUrl.origin}${handoffUrl.pathname}`, redirect);
  assert.equal(handoffUrl.searchParams.has('token'), false);
  const exchangeBody = { code: handoffUrl.searchParams.get('code'), verifier };
  const exchange = () => fetch(`${api}/auth/extension/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(exchangeBody) });
  const extensionExchange = await exchange();
  assert.equal(extensionExchange.status, 200);
  const extensionSession = await extensionExchange.json();
  assert.ok(Date.parse(extensionSession.expiresAt) <= Date.now() + 900000);
  assert.equal((await exchange()).status, 401);
  const extensionPreferences = await fetch(`${api}/v1/me/preferences`, { headers: { Authorization: `Bearer ${extensionSession.token}` } });
  assert.equal(extensionPreferences.status, 200);
  assert.deepEqual(await extensionPreferences.json(), updatedPreferences);
  assert.equal((await fetch(`${api}/auth/extension/logout`, { method: 'POST', headers: { Authorization: `Bearer ${extensionSession.token}` } })).status, 204);
  assert.equal((await fetch(`${api}/auth/extension/logout`, { method: 'POST', headers: { Authorization: `Bearer ${extensionSession.token}` } })).status, 401);
  const columns = await database.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'klaro' AND table_name = 'sessions'");
  assert.ok(!columns.rows.some(row => ['token', 'access_token', 'refresh_token', 'csrf_token'].includes(row.column_name)));
  console.info('HTTP OIDC, session security, extension handoff and isolated preferences passed');
} finally {
  child.kill();
  if (child.exitCode === null) await once(child, 'exit');
  await database.query('DELETE FROM klaro.users WHERE id IN (SELECT user_id FROM klaro.external_identities WHERE issuer = $1)', [provider.issuer]);
  await database.end();
  await provider.close();
}
