import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import pg from 'pg';
import { createClient } from 'redis';
import { SessionService } from '../dist/api/identity/sessions.js';
import { DEFAULT_PREFERENCES, AcceptedSchema, OperationEventSchema, OperationSnapshotSchema, UsageSummarySchema } from '@klaro/contracts';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6380';
const database = new pg.Client({ connectionString: databaseUrl });
const redis = createClient({ url: redisUrl });
const sessions = new SessionService(databaseUrl);
await database.connect(); await redis.connect();
const issuer = `https://synthetic.test/${randomUUID()}`;
const first = await sessions.signIn({ issuer, subject: 'first' });
const second = await sessions.signIn({ issuer, subject: 'second' });
const extension = await sessions.signIn({ issuer, subject: 'first' }, 'extension');
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const api = `http://127.0.0.1:${port}`;
const origin = 'https://klaro.test';
const child = spawn(process.execPath, ['dist/api/main.js'], { env: { ...process.env, NODE_ENV: 'test', PORT: String(port), APP_ORIGIN: origin, AI_PROVIDER: 'double', OPERATION_HMAC_KEY: randomBytes(32).toString('hex') }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
const sockets = [];
const command = overrides => ({ version: 'v1', clientRequestId: randomUUID(), revisionId: randomUUID(), operationType: 'correction', surface: 'web', input: 'Synthetic private canary 😀', selection: { scope: 'document' }, preferences: DEFAULT_PREFERENCES, sourceLanguage: 'de', targetLanguage: 'de', protectedSpans: [], ...overrides });
const request = (session, path, body) => fetch(`${api}/v1/operations${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: `__Host-klaro_session=${session.token}`, Origin: origin, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function connect(session, auth = { csrfToken: session.csrfToken }, extraHeaders = { Cookie: `__Host-klaro_session=${session.token}`, Origin: origin }) {
  const socket = io(`${api}/v1/operations`, { transports: ['websocket'], reconnection: false, auth, extraHeaders, timeout: 3000 });
  sockets.push(socket); await once(socket, 'connect'); return socket;
}
const ack = (socket, event, body) => socket.timeout(3000).emitWithAck(event, body);
async function completed(id) {
  for (let index = 0; index < 100; index++) {
    const snapshot = await (await request(first, `/${id}`)).json();
    OperationSnapshotSchema.parse(snapshot);
    if (snapshot.status === 'completed') return snapshot;
    if (snapshot.error) throw new Error(snapshot.error.code);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Operation did not complete');
}
try {
  let ready = false;
  for (let index = 0; index < 50; index++) { try { ready = (await fetch(`${api}/health`)).ok; } catch {} if (ready) break; if (child.exitCode !== null) throw new Error('API exited'); await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready);
  const socket = await connect(first);
  const other = await connect(second);
  const events = []; const otherEvents = [];
  socket.on('operation.event', event => events.push(OperationEventSchema.parse(event)));
  other.on('operation.event', event => otherEvents.push(event));
  const original = command();
  const acceptedResponse = await request(first, '', original);
  assert.equal(acceptedResponse.status, 202);
  const accepted = AcceptedSchema.parse(await acceptedResponse.json());
  assert.deepEqual(await ack(socket, 'operation.accept', original), accepted);
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => ack(socket, 'operation.accept', original)));
  assert.ok(concurrent.every(value => value.operationId === accepted.operationId));
  const another = AcceptedSchema.parse(await ack(socket, 'operation.accept', command()));
  await Promise.all([completed(accepted.operationId), completed(another.operationId)]);
  assert.equal((await request(first, '', { ...original, input: 'Different payload' })).status, 409);
  assert.deepEqual((await ack(socket, 'operation.accept', { ...original, input: 'Different payload' })).error, { code: 'conflict', retryable: false });
  for (const invalid of [{ ...command(), userId: second.userId }, command({ surface: 'panel' }), command({ selection: { scope: 'selection', start: 1000, end: 1001 } }), command({ preferences: { ...DEFAULT_PREFERENCES, style: 'formal' } })]) {
    const response = await request(first, '', invalid);
    const result = await ack(socket, 'operation.accept', invalid);
    assert.deepEqual(result.error, await response.json()); assert.ok([400, 409].includes(response.status));
  }
  assert.equal((await request(second, `/${accepted.operationId}`)).status, 403);
  assert.equal((await request(second, `/${accepted.operationId}/cancel`, {})).status, 403);
  assert.equal((await ack(other, 'operation.snapshot', { operationId: accepted.operationId })).error.code, 'forbidden');
  assert.equal((await ack(other, 'operation.cancel', { operationId: accepted.operationId })).error.code, 'forbidden');
  assert.equal(otherEvents.length, 0);
  const snapshot = await ack(socket, 'operation.snapshot', { operationId: accepted.operationId });
  assert.deepEqual(snapshot, await (await request(first, `/${accepted.operationId}`)).json());
  assert.equal(snapshot.results.length, 2);
  const backup = execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'pg_dump', '-U', 'klaro', '-d', 'klaro', ...['users','external_identities','user_preferences','sessions','operations','stage_attempts','usage_ledger','budget_reservations','budget_accounts','reference_error_reports','account_deletion_tombstones'].flatMap(table => ['--table', `klaro.${table}`])], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.ok(!backup.includes(original.input));
  assert.ok(!logs.includes(original.input));
  const recommendation = snapshot.results[0];
  for (const type of ['back-translation', 'explanation']) {
    const response = await request(first, '', command({ operationType: type, targetLanguage: 'uk', parent: { operationId: accepted.operationId, recommendationId: recommendation.recommendationId }, recommendation: { recommendationId: recommendation.recommendationId, text: recommendation.text } }));
    assert.equal(response.status, 202); await completed((await response.json()).operationId);
  }
  const retry = await request(first, '', command()); assert.equal(retry.status, 202); await completed((await retry.json()).operationId);
  const usage = UsageSummarySchema.parse(await (await fetch(`${api}/v1/me/usage`, { headers: { Cookie: `__Host-klaro_session=${first.token}` } })).json());
  assert.equal(usage.operations, 5); assert.equal(usage.providerAttempts, 8);
  const ledger = (await database.query('SELECT sum(input_tokens) AS input, sum(output_tokens) AS output FROM klaro.usage_ledger WHERE user_id = $1', [first.userId])).rows[0];
  assert.equal(usage.actual.inputTokens, Number(ledger.input)); assert.equal(usage.actual.outputTokens, Number(ledger.output));
  assert.equal(usage.estimated.inputTokens, 0);
  const otherUsage = await (await fetch(`${api}/v1/me/usage`, { headers: { Cookie: `__Host-klaro_session=${second.token}` } })).json();
  assert.equal(otherUsage.operations, 0); assert.equal(otherUsage.providerAttempts, 0);
  const selectionResponse = await request(first, '', command({ input: 'Prefix 😀 SELECTED suffix', selection: { scope: 'selection', start: 7, end: 18 }, context: 'Prefix\n\nsuffix' }));
  assert.equal(selectionResponse.status, 202);
  const selectionResult = await completed((await selectionResponse.json()).operationId);
  assert.ok(selectionResult.results.every(result => result.text === '😀 SELECTED'));
  const variantsResponse = await request(first, '', command({ operationType: 'alternatives', parent: { operationId: accepted.operationId, recommendationId: recommendation.recommendationId }, recommendation: { recommendationId: recommendation.recommendationId, text: recommendation.text } }));
  assert.equal(variantsResponse.status, 202); const variantsId = (await variantsResponse.json()).operationId;
  const variants = await completed(variantsId); assert.equal(variants.results.length, 1); assert.equal(variants.results[0].kind, 'alternatives'); assert.equal(variants.results[0].alternatives.length, 3);
  assert.equal(Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE operation_id = $1', [variantsId])).rows[0].count), 1);
  const paraphraseResponse = await request(first, '', command({ operationType: 'paraphrase' })); assert.equal(paraphraseResponse.status, 202); const paraphraseId = (await paraphraseResponse.json()).operationId;
  assert.equal((await completed(paraphraseId)).results.length, 2);
  assert.equal(Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE operation_id = $1', [paraphraseId])).rows[0].count), 2);
  assert.ok(events.some(event => event.event === 'operation.completed'));
  const attemptsBefore = Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE user_id = $1', [first.userId])).rows[0].count);
  socket.disconnect(); const reconnected = await connect(first);
  assert.deepEqual(await ack(reconnected, 'operation.snapshot', { operationId: accepted.operationId }), snapshot);
  assert.equal(Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE user_id = $1', [first.userId])).rows[0].count), attemptsBefore);
  const panel = await connect(extension, { token: extension.token }, { Origin: origin });
  const panelCommand = command({ surface: 'panel' });
  AcceptedSchema.parse(await ack(panel, 'operation.accept', panelCommand));
  assert.equal((await ack(panel, 'operation.accept', command())).error.code, 'invalid-request');
  const denied = io(`${api}/v1/operations`, { transports: ['websocket'], reconnection: false, auth: {}, extraHeaders: { Origin: origin }, timeout: 3000 }); sockets.push(denied);
  assert.match((await once(denied, 'connect_error'))[0].message, /unauthenticated/);
  await redis.del(`klaro:payload:${first.userId}:${accepted.operationId}`);
  assert.equal((await request(first, '', original)).status, 410);
  const expired = await ack(reconnected, 'operation.snapshot', { operationId: accepted.operationId });
  assert.equal(expired.payloadStatus, 'expired'); assert.deepEqual(expired.results, []);
  assert.equal(Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE operation_id = $1', [accepted.operationId])).rows[0].count), 2);
  const expiring = await sessions.signIn({ issuer, subject: 'first' }, 'extension');
  const { createHash } = await import('node:crypto');
  await database.query("UPDATE klaro.sessions SET expires_at = now() + interval '700 milliseconds' WHERE token_hash = $1", [createHash('sha256').update(expiring.token).digest()]);
  const expiringSocket = await connect(expiring, { token: expiring.token }, { Origin: origin });
  await once(expiringSocket, 'disconnect'); assert.equal(expiringSocket.connected, false);
  assert.equal(await sessions.authenticate(expiring.token, 'extension'), undefined);
  await sessions.revokeAll(first.userId);
  assert.equal((await ack(reconnected, 'operation.snapshot', { operationId: accepted.operationId })).error.code, 'unauthenticated');
  console.info('REST/socket parity, IDOR isolation, idempotency, expiry and reconnect passed');
} finally {
  for (const socket of sockets) socket.disconnect();
  child.kill(); if (child.exitCode === null) await once(child, 'exit');
  const keys = await redis.keys(`klaro:payload:${first.userId}:*`); if (keys.length) await redis.del(keys);
  await database.query('DELETE FROM klaro.users WHERE id IN ($1, $2)', [first.userId, second.userId]);
  await sessions.close(); await redis.close(); await database.end();
}
