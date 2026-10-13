import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';

const connection = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro' });
await connection.connect();
try {
  await connection.query('BEGIN');
  const userId = randomUUID();
  const otherUser = randomUUID();
  const operationId = randomUUID();
  const attemptId = randomUUID();
  await connection.query('INSERT INTO klaro.users (id) VALUES ($1), ($2)', [userId, otherUser]);
  async function operation(id, user) {
    return connection.query("INSERT INTO klaro.operations (id, user_id, client_request_id, revision_id, operation_type, payload_digest, digest_expires_at, payload_expires_at, workflow_version, model_policy_version, prompt_policy_version, input_code_points) VALUES ($1, $2, 'synthetic-request', 'synthetic-revision', 'correction', $3, now() + interval '24 hours', now() + interval '30 minutes', 'workflow-v1', 'double-v1', 'prompt-v1', 10)", [id, user, randomBytes(32)]);
  }
  await operation(operationId, userId);
  await operation(randomUUID(), otherUser);
  async function rejected(action, code) {
    await connection.query('SAVEPOINT invalid');
    try { await assert.rejects(action(), error => error.code === code); }
    finally { await connection.query('ROLLBACK TO SAVEPOINT invalid'); }
  }
  await rejected(() => operation(randomUUID(), userId), '23505');
  await connection.query("INSERT INTO klaro.stage_attempts (id, operation_id, user_id, stage_id, attempt_number, status, model_policy_version, prompt_policy_version) VALUES ($1, $2, $3, 'correction', 1, 'completed', 'double-v1', 'prompt-v1')", [attemptId, operationId, userId]);
  const settlement = user => connection.query("INSERT INTO klaro.usage_ledger (id, stage_attempt_id, operation_id, user_id, input_tokens, output_tokens, cost_microusd, usage_kind, price_policy_version) VALUES ($1, $2, $3, $4, 10, 10, 1, 'actual', 'price-v1')", [randomUUID(), attemptId, operationId, user]);
  await rejected(() => settlement(otherUser), '23503');
  await settlement(userId);
  await rejected(() => settlement(userId), '23505');
  const reservation = () => connection.query("INSERT INTO klaro.budget_reservations (id, operation_id, user_id, budget_day, reserved_tokens, remaining_tokens, reserved_cost_microusd, remaining_cost_microusd, state, budget_policy_version, price_policy_version, expires_at) VALUES ($1, $2, $3, current_date, 100, 100, 100, 100, 'reserved', 'budget-v1', 'price-v1', now() + interval '1 hour')", [randomUUID(), operationId, userId]);
  await reservation();
  await rejected(reservation, '23505');
  for (const table of ['operations', 'stage_attempts', 'usage_ledger', 'budget_reservations']) {
    const columns = await connection.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'klaro' AND table_name = $1", [table]);
    assert.ok(!columns.rows.some(row => ['input', 'text', 'result', 'payload', 'prompt', 'response', 'context'].includes(row.column_name)));
  }
  console.info('Operation metadata, idempotency uniqueness, account foreign keys and settlement uniqueness passed');
} finally {
  await connection.query('ROLLBACK');
  await connection.end();
}
