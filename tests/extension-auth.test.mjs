import assert from 'node:assert/strict';
import test from 'node:test';
import { ExtensionAuth } from '../apps/extension/src/auth.ts';

const redirect = 'https://synthetic.chromiumapp.org/klaro';
const token = 'a'.repeat(43);
let now = Date.now();
const identity = {
  getRedirectURL: () => redirect,
  launchWebAuthFlow: async details => {
    assert.equal(details.interactive, true);
    const url = new URL(details.url);
    assert.equal(url.searchParams.get('redirectUri'), redirect);
    assert.equal(url.searchParams.get('codeChallenge').length, 43);
    return `${redirect}?code=${'c'.repeat(43)}`;
  },
};

function client(fetcher = async (url, options) => {
  assert.equal(options.credentials, 'omit');
  if (url.pathname.endsWith('exchange')) return Response.json({ token, expiresAt: new Date(now + 900000).toISOString() });
  return new Response(null, { status: 204 });
}) { return new ExtensionAuth(identity, 'https://klaro.test', fetcher, () => now); }

test('extension token is memory-only and clears on logout, expiry and document end', async () => {
  const auth = client();
  assert.equal(auth.authorization(), undefined);
  await auth.signIn();
  assert.equal(auth.authorization(), `Bearer ${token}`);
  assert.equal(client().authorization(), undefined);
  await auth.signOut();
  assert.equal(auth.authorization(), undefined);
  await auth.signIn();
  auth.dispose();
  assert.equal(auth.authorization(), undefined);
  await auth.signIn();
  now += 900001;
  assert.equal(auth.authorization(), undefined);
});

test('late login after disposal cannot restore a token and revokes the returned session', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let exchanged;
  const started = new Promise(resolve => { exchanged = resolve; });
  let revoked = false;
  const auth = client(async url => {
    if (url.pathname.endsWith('exchange')) {
      exchanged();
      await gate;
      return Response.json({ token, expiresAt: new Date(now + 900000).toISOString() });
    }
    revoked = true;
    return new Response(null, { status: 204 });
  });
  const pending = auth.signIn();
  await started;
  auth.dispose();
  release();
  await pending;
  assert.equal(auth.authorization(), undefined);
  assert.equal(revoked, true);
});

test('logout clears the local token even when the network fails', async () => {
  const auth = client(async url => {
    if (url.pathname.endsWith('exchange')) return Response.json({ token, expiresAt: new Date(now + 900000).toISOString() });
    throw new Error('Offline');
  });
  await auth.signIn();
  await auth.signOut();
  assert.equal(auth.authorization(), undefined);
});
