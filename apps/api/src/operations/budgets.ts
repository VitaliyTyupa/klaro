import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { ApplicationError } from './errors';

export interface BudgetPolicy {
  version: string;
  userRequestsPerMinute: number;
  userConcurrency: number;
  globalConcurrency: number;
  userDailyTokens: number;
  globalDailyTokens: number;
  userDailyCostMicrousd: number;
  globalDailyCostMicrousd: number;
}
export interface StageBound { inputTokens: number; outputTokens: number; costMicrousd: number; }
export const DOUBLE_BUDGET_POLICY: Readonly<BudgetPolicy> = Object.freeze({ version: 'development-v1', userRequestsPerMinute: 20, userConcurrency: 2, globalConcurrency: 20, userDailyTokens: 5000000, globalDailyTokens: 50000000, userDailyCostMicrousd: 0, globalDailyCostMicrousd: 0 });

export class BudgetService {
  constructor(readonly policy: Readonly<BudgetPolicy> = DOUBLE_BUDGET_POLICY) {
    for (const [key, value] of Object.entries(policy)) if (key !== 'version' && (!Number.isSafeInteger(value) || Number(value) < 0)) throw new Error('Invalid budget policy');
  }

  async lock(connection: pg.PoolClient): Promise<void> { await connection.query('SELECT pg_advisory_xact_lock(81743002)'); }

  async reserve(connection: pg.PoolClient, userId: string, operationId: string, bound: StageBound, stages: number, priceVersion: string): Promise<void> {
    await this.lock(connection);
    const tokens = (bound.inputTokens + bound.outputTokens) * stages;
    const cost = bound.costMicrousd * stages;
    const day = (await connection.query<{ day: string }>("SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day")).rows[0]!.day;
    await connection.query("INSERT INTO klaro.budget_accounts (scope_key, user_id, budget_day) VALUES ('global', NULL, $2::date), ('user:' || $1::text, $1::uuid, $2::date) ON CONFLICT DO NOTHING", [userId, day]);
    const usage = await connection.query("SELECT scope_key, spent_tokens, spent_cost_microusd FROM klaro.budget_accounts WHERE budget_day = $2 AND scope_key IN ('global', 'user:' || $1::text)", [userId, day]);
    const reservations = await connection.query("SELECT user_id, budget_day::text, remaining_tokens, remaining_cost_microusd FROM klaro.budget_reservations WHERE state IN ('reserved', 'unknown')");
    const active = reservations.rows;
    const mine = active.filter(row => row.user_id === userId);
    const rate = await connection.query("SELECT count(*) FROM klaro.operations WHERE user_id = $1 AND created_at > now() - interval '1 minute' AND id <> $2", [userId, operationId]);
    if (mine.length >= this.policy.userConcurrency || active.length >= this.policy.globalConcurrency || Number(rate.rows[0].count) >= this.policy.userRequestsPerMinute) throw new ApplicationError('quota-exceeded');
    for (const scope of ['global', `user:${userId}`]) {
      const spent = usage.rows.find(row => row.scope_key === scope)!;
      const held = active.filter(row => row.budget_day === day && (scope === 'global' || row.user_id === userId));
      const tokenLimit = scope === 'global' ? this.policy.globalDailyTokens : this.policy.userDailyTokens;
      const costLimit = scope === 'global' ? this.policy.globalDailyCostMicrousd : this.policy.userDailyCostMicrousd;
      if (Number(spent.spent_tokens) + held.reduce((sum, row) => sum + Number(row.remaining_tokens), 0) + tokens > tokenLimit || Number(spent.spent_cost_microusd) + held.reduce((sum, row) => sum + Number(row.remaining_cost_microusd), 0) + cost > costLimit) throw new ApplicationError('quota-exceeded');
    }
    await connection.query("INSERT INTO klaro.budget_reservations (id, operation_id, user_id, budget_day, reserved_tokens, reserved_cost_microusd, remaining_tokens, remaining_cost_microusd, state, budget_policy_version, price_policy_version, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $5, $6, 'reserved', $7, $8, now() + interval '30 minutes')", [randomUUID(), operationId, userId, day, tokens, cost, this.policy.version, priceVersion]);
  }

  async beforeDispatch(connection: pg.PoolClient, operationId: string, bound: StageBound): Promise<void> {
    await this.lock(connection);
    const reservation = (await connection.query('SELECT * FROM klaro.budget_reservations WHERE operation_id = $1 FOR UPDATE', [operationId])).rows[0];
    if (!reservation || !['reserved', 'unknown'].includes(reservation.state)) throw new ApplicationError('quota-exceeded');
    const held = (await connection.query("SELECT COALESCE(sum(a.input_token_bound + a.output_token_bound), 0) AS tokens, COALESCE(sum(a.cost_bound_microusd), 0) AS cost FROM klaro.stage_attempts a WHERE a.operation_id = $1 AND a.dispatched_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM klaro.usage_ledger l WHERE l.stage_attempt_id = a.id)", [operationId])).rows[0];
    if (Number(reservation.remaining_tokens) - Number(held.tokens) < bound.inputTokens + bound.outputTokens || Number(reservation.remaining_cost_microusd) - Number(held.cost) < bound.costMicrousd) throw new ApplicationError('quota-exceeded');
  }

  async settle(connection: pg.PoolClient, attemptId: string, inputTokens: number, outputTokens: number, costMicrousd: number, kind: 'actual' | 'estimated'): Promise<void> {
    await this.lock(connection);
    const attempt = (await connection.query('SELECT * FROM klaro.stage_attempts WHERE id = $1 FOR UPDATE', [attemptId])).rows[0];
    if (!attempt) throw new ApplicationError('unavailable');
    if ((await connection.query('SELECT id FROM klaro.usage_ledger WHERE stage_attempt_id = $1', [attemptId])).rowCount) return;
    for (const value of [inputTokens, outputTokens, costMicrousd]) if (!Number.isSafeInteger(value) || value < 0) throw new ApplicationError('invalid-result');
    if (inputTokens > Number(attempt.input_token_bound) || outputTokens > Number(attempt.output_token_bound) || costMicrousd > Number(attempt.cost_bound_microusd)) throw new ApplicationError('invalid-result');
    const reservation = (await connection.query('SELECT * FROM klaro.budget_reservations WHERE operation_id = $1 FOR UPDATE', [attempt.operation_id])).rows[0];
    if (!reservation || Number(reservation.remaining_tokens) < inputTokens + outputTokens || Number(reservation.remaining_cost_microusd) < costMicrousd) throw new ApplicationError('unavailable');
    await connection.query('INSERT INTO klaro.usage_ledger (id, stage_attempt_id, operation_id, user_id, input_tokens, output_tokens, cost_microusd, usage_kind, price_policy_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [randomUUID(), attemptId, attempt.operation_id, attempt.user_id, inputTokens, outputTokens, costMicrousd, kind, reservation.price_policy_version]);
    await connection.query("UPDATE klaro.budget_accounts SET spent_tokens = spent_tokens + $3, spent_cost_microusd = spent_cost_microusd + $4 WHERE budget_day = $2 AND scope_key IN ('global', 'user:' || $1::text)", [attempt.user_id, reservation.budget_day, inputTokens + outputTokens, costMicrousd]);
    await connection.query('UPDATE klaro.budget_reservations SET remaining_tokens = remaining_tokens - $2, remaining_cost_microusd = remaining_cost_microusd - $3 WHERE operation_id = $1', [attempt.operation_id, inputTokens + outputTokens, costMicrousd]);
  }

  async finish(connection: pg.PoolClient, operationId: string): Promise<void> {
    await this.lock(connection);
    const unknown = (await connection.query("SELECT COALESCE(sum(a.input_token_bound + a.output_token_bound), 0) AS tokens, COALESCE(sum(a.cost_bound_microusd), 0) AS cost, count(*) AS count FROM klaro.stage_attempts a WHERE a.operation_id = $1 AND a.dispatched_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM klaro.usage_ledger l WHERE l.stage_attempt_id = a.id)", [operationId])).rows[0];
    await connection.query("UPDATE klaro.budget_reservations SET remaining_tokens = $2, remaining_cost_microusd = $3, state = $4 WHERE operation_id = $1", [operationId, unknown.tokens, unknown.cost, Number(unknown.count) ? 'unknown' : 'settled']);
  }

  async reconcile(connection: pg.PoolClient, now = new Date()): Promise<void> {
    await this.lock(connection);
    const expired = await connection.query("SELECT operation_id FROM klaro.budget_reservations WHERE state IN ('reserved', 'unknown') AND expires_at <= $1 FOR UPDATE", [now]);
    for (const reservation of expired.rows) {
      const attempts = await connection.query('SELECT a.* FROM klaro.stage_attempts a WHERE a.operation_id = $1 AND a.dispatched_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM klaro.usage_ledger l WHERE l.stage_attempt_id = a.id)', [reservation.operation_id]);
      for (const attempt of attempts.rows) await this.settle(connection, attempt.id, Number(attempt.input_token_bound), Number(attempt.output_token_bound), Number(attempt.cost_bound_microusd), 'estimated');
      await this.finish(connection, reservation.operation_id);
    }
  }
}
