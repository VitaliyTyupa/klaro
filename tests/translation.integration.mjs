import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import pg from 'pg';
import { createClient } from 'redis';
import { SessionService } from '../dist/api/identity/sessions.js';
import { DEFAULT_PREFERENCES, OperationSnapshotSchema } from '@klaro/contracts';
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro';
const database = new pg.Client({ connectionString: databaseUrl }); await database.connect();
const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6380' }); await redis.connect();
const sessions = new SessionService(databaseUrl); const users = [];
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const api = `http://127.0.0.1:${port}`; const origin = 'https://klaro.test';
const child = spawn(process.execPath, ['dist/api/main.js'], { env: { ...process.env, NODE_ENV: 'test', PORT: String(port), APP_ORIGIN: origin, AI_PROVIDER: 'double', OPERATION_HMAC_KEY: randomBytes(32).toString('hex') }, stdio: ['ignore', 'pipe', 'pipe'] });
const until = async predicate => { for (let index = 0; index < 200; index++) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Translation test timed out'); };
const request = (session, path, method = 'GET', body) => fetch(`${api}${path}`, { method, headers: { Cookie: `__Host-klaro_session=${session.token}`, Origin: origin, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
try {
  await until(async () => { try { return (await fetch(`${api}/health`)).ok; } catch { return false; } });
  const languages = ['uk', 'de', 'en', 'vi']; const directions = new Set();
  for (const nativeLanguage of languages) {
    const session = await sessions.signIn({ issuer: `https://synthetic.test/${randomUUID()}`, subject: 'translation' }); users.push(session.userId);
    for (const activeWritingLanguage of languages.filter(value => value !== nativeLanguage)) {
      const preferences = { ...DEFAULT_PREFERENCES, nativeLanguage, activeWritingLanguage, writingLanguages: [activeWritingLanguage], style: 'formal', proficiency: 'B2' };
      assert.equal((await request(session, '/v1/me/preferences', 'PUT', preferences)).status, 200);
      for (const [sourceLanguage, targetLanguage] of [[nativeLanguage, activeWritingLanguage], [activeWritingLanguage, nativeLanguage]]) {
        const command = { version: 'v1', clientRequestId: randomUUID(), revisionId: randomUUID(), operationType: 'translation', surface: 'web', input: 'Private prefix Selected 3\n\nABC-123 Private suffix', selection: { scope: 'selection', start: 15, end: 34 }, context: 'Explicit synthetic context', preferences, sourceLanguage, targetLanguage, protectedSpans: [{ start: 27, end: 34 }] };
        const accepted = await request(session, '/v1/operations', 'POST', command); assert.equal(accepted.status, 202); const { operationId } = await accepted.json();
        const snapshot = await until(async () => { const value = OperationSnapshotSchema.parse(await (await request(session, `/v1/operations/${operationId}`)).json()); if (value.error) throw new Error(value.error.code); return value.status === 'completed' ? value : false; });
        assert.equal(snapshot.results.length, 1); assert.equal(snapshot.results[0].kind, 'translation'); assert.equal(snapshot.results[0].language, targetLanguage); assert.equal(snapshot.results[0].text, 'Selected 3\n\nABC-123');
        assert.equal(Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE operation_id = $1', [operationId])).rows[0].count), 1);
        assert.deepEqual(await (await request(session, '/v1/me/preferences')).json(), preferences); directions.add(`${sourceLanguage}-${targetLanguage}`);
        const unrelated = languages.find(value => value !== nativeLanguage && value !== activeWritingLanguage);
        assert.equal((await request(session, '/v1/operations', 'POST', { ...command, clientRequestId: randomUUID(), sourceLanguage: activeWritingLanguage, targetLanguage: unrelated })).status, 400);
      }
    }
    assert.equal(Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE user_id = $1', [session.userId])).rows[0].count), 6);
  }
  assert.equal(directions.size, 12); console.info('12 translation directions / 24 native-role cases, selection, one attempt, profile preservation and cross-language rejection passed (provider double)');
} finally {
  child.kill(); if (child.exitCode === null) await once(child, 'exit');
  for (const user of users) { const keys = await redis.keys(`klaro:payload:${user}:*`); if (keys.length) await redis.del(keys); await database.query('DELETE FROM klaro.users WHERE id = $1', [user]); }
  await sessions.close(); await database.end(); await redis.close();
}
