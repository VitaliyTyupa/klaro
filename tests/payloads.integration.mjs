import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from 'redis';
import pg from 'pg';
import { PayloadStore } from '../dist/api/operations/payloads.js';
import { DEFAULT_PREFERENCES } from '@klaro/contracts';

const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6380';
const redis = createClient({ url }); await redis.connect();
const store = new PayloadStore(url, 700, 200);
const owner = randomUUID(), other = randomUUID(), id = randomUUID(), canary = `private-payload-${randomUUID()}`;
const command = { version: 'v1', clientRequestId: randomUUID(), revisionId: randomUUID(), operationType: 'translation', surface: 'web', input: canary, selection: { scope: 'document' }, preferences: DEFAULT_PREFERENCES, sourceLanguage: 'uk', targetLanguage: 'de', protectedSpans: [] };
try {
  assert.equal((await redis.configGet('save')).save, '');
  assert.equal((await redis.configGet('appendonly')).appendonly, 'no');
  await store.create(owner, id, command);
  assert.equal(await store.get(other, id), undefined);
  await assert.rejects(store.create(owner, id, command), error => error.detail.code === 'conflict');
  const key = `klaro:payload:${owner}:${id}`;
  const initial = await redis.pTTL(key); assert.ok(initial > 0 && initial <= 700);
  const payload = await store.get(owner, id); payload.sequence = 1;
  await new Promise(resolve => setTimeout(resolve, 50));
  await store.update(owner, id, payload);
  assert.ok(await redis.pTTL(key) < initial);
  await assert.rejects(store.update(owner, id, { ...payload, sequence: 0 }), error => error.detail.code === 'conflict');
  await store.update(owner, id, payload, true);
  assert.ok(await redis.pTTL(key) <= 200);
  await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(await store.get(owner, id), undefined);
  await assert.rejects(store.update(owner, id, payload), error => error.detail.code === 'payload-expired');
  const absoluteId = randomUUID(); await store.create(owner, absoluteId, command);
  await new Promise(resolve => setTimeout(resolve, 730));
  assert.equal(await store.get(owner, absoluteId), undefined);
  const cleanupId = randomUUID(); await store.create(owner, cleanupId, command); await store.delete(owner, cleanupId);
  assert.equal(await store.get(owner, cleanupId), undefined);
  const database = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro' }); await database.connect();
  try {
    for (const table of ['operations', 'stage_attempts', 'usage_ledger', 'budget_reservations']) {
      const values = await database.query(`SELECT row_to_json(t)::text AS value FROM klaro.${table} t`);
      assert.ok(values.rows.every(row => !row.value.includes(canary)));
    }
  } finally { await database.end(); }
  const logs = execFileSync('docker', ['compose', 'logs', '--no-color'], { encoding: 'utf8' });
  assert.ok(!logs.includes(canary));
  console.info('Redis user scoping, absolute/result TTL, no resurrection, cleanup and persistence/log checks passed');
} finally { await store.close(); await redis.close(); }
