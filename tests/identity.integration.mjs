import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro' });
await client.connect();
try {
  await client.query('BEGIN');
  const first = randomUUID();
  const second = randomUUID();
  await client.query('INSERT INTO klaro.users (id) VALUES ($1), ($2)', [first, second]);
  await client.query('INSERT INTO klaro.user_preferences (user_id) VALUES ($1), ($2)', [first, second]);
  await client.query("UPDATE klaro.user_preferences SET writing_languages = ARRAY['en'], active_writing_language = 'en' WHERE user_id = $1", [second]);
  const firstPreferences = await client.query('SELECT active_writing_language FROM klaro.user_preferences WHERE user_id = $1', [first]);
  const secondPreferences = await client.query('SELECT active_writing_language FROM klaro.user_preferences WHERE user_id = $1', [second]);
  assert.equal(firstPreferences.rows[0].active_writing_language, 'de');
  assert.equal(secondPreferences.rows[0].active_writing_language, 'en');
  const identity = randomUUID();
  await client.query('INSERT INTO klaro.external_identities (id, user_id, issuer, subject) VALUES ($1, $2, $3, $4)', [identity, first, 'http://local-test-provider', 'synthetic-subject']);
  const sessionId = randomUUID();
  const tokenHash = createHash('sha256').update(randomUUID()).digest();
  await client.query("INSERT INTO klaro.sessions (id, user_id, token_hash, client_kind, expires_at) VALUES ($1, $2, $3, 'web', now() + interval '1 hour')", [sessionId, first, tokenHash]);

  async function rejected(sql, values, code) {
    await client.query('SAVEPOINT rejected');
    try {
      await assert.rejects(client.query(sql, values), error => error.code === code);
    } finally { await client.query('ROLLBACK TO SAVEPOINT rejected'); }
  }
  await rejected('INSERT INTO klaro.user_preferences (user_id) VALUES ($1)', [first], '23505');
  await rejected('INSERT INTO klaro.external_identities (id, user_id, issuer, subject) VALUES ($1, $2, $3, $4)', [randomUUID(), second, 'http://local-test-provider', 'synthetic-subject'], '23505');
  await rejected("INSERT INTO klaro.sessions (id, user_id, token_hash, client_kind, expires_at) VALUES ($1, $2, $3, 'extension', now() + interval '1 hour')", [randomUUID(), second, tokenHash], '23505');
  await rejected('INSERT INTO klaro.user_preferences (user_id) VALUES ($1)', [randomUUID()], '23503');
  await rejected("UPDATE klaro.user_preferences SET writing_languages = ARRAY['uk'] WHERE user_id = $1", [first], '23514');
  await rejected("UPDATE klaro.user_preferences SET writing_languages = ARRAY['de','de'] WHERE user_id = $1", [first], '23514');
  assert.equal((await client.query('SELECT id FROM klaro.sessions WHERE id = $1 AND user_id = $2', [sessionId, second])).rowCount, 0);
  assert.equal((await client.query('SELECT id FROM klaro.sessions WHERE id = $1 AND user_id = $2', [sessionId, first])).rowCount, 1);
  await client.query('DELETE FROM klaro.users WHERE id = $1', [first]);
  for (const table of ['external_identities', 'sessions', 'user_preferences']) {
    assert.equal((await client.query(`SELECT 1 FROM klaro.${table} WHERE user_id = $1`, [first])).rowCount, 0);
  }
  assert.equal((await client.query('SELECT 1 FROM klaro.user_preferences WHERE user_id = $1', [second])).rowCount, 1);
  console.info('Identity constraints and two-user data separation passed');
} finally {
  await client.query('ROLLBACK');
  await client.end();
}
