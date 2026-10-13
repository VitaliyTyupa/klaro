import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

export async function startOidcProvider() {
const { privateKey, publicKey } = await generateKeyPair('RS256');
const key = { ...await exportJWK(publicKey), kid: 'local-key', alg: 'RS256', use: 'sig' };
const codes = new Map();
let issuer;
let mode = 'valid';
let subject = 'synthetic-user';
let exchanges = 0;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, issuer);
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/.well-known/openid-configuration') {
      response.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}authorize`, token_endpoint: `${issuer}token`, jwks_uri: `${issuer}jwks`, response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'] }));
    } else if (url.pathname === '/jwks') {
      response.end(JSON.stringify({ keys: [key] }));
    } else if (url.pathname === '/authorize') {
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(url.searchParams.get('nonce'));
      const code = randomBytes(32).toString('base64url');
      codes.set(code, { nonce: url.searchParams.get('nonce'), challenge: url.searchParams.get('code_challenge'), callback: url.searchParams.get('redirect_uri') });
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.searchParams.set('code', code);
      callback.searchParams.set('state', url.searchParams.get('state'));
      response.writeHead(302, { Location: callback.href });
      response.end();
    } else if (url.pathname === '/token') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const parameters = new URLSearchParams(body);
      const code = parameters.get('code');
      const flow = codes.get(code);
      codes.delete(code);
      assert.ok(flow);
      assert.equal(parameters.get('grant_type'), 'authorization_code');
      assert.equal(parameters.get('redirect_uri'), flow.callback);
      assert.equal(createHash('sha256').update(parameters.get('code_verifier')).digest('base64url'), flow.challenge);
      exchanges++;
      const token = await new SignJWT({ nonce: mode === 'nonce' ? 'wrong' : flow.nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'local-key' }).setIssuer(mode === 'issuer' ? `${issuer}wrong` : issuer)
        .setAudience(mode === 'audience' ? 'wrong-client' : 'klaro-test').setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(privateKey);
      response.end(JSON.stringify({ token_type: 'Bearer', access_token: 'synthetic-access-token', expires_in: 300, id_token: token }));
    } else { response.writeHead(404); response.end('{}'); }
  } catch { response.writeHead(400); response.end('{"error":"invalid_request"}'); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
issuer = `http://127.0.0.1:${server.address().port}/`;
return {
  issuer,
  setSubject: value => { subject = value; },
  setMode: value => { mode = value; },
  exchanges: () => exchanges,
  close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
};
}
