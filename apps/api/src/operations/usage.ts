import { Controller, Get, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import pg from 'pg';
import { UsageSummarySchema, type UsageSummary } from '@klaro/contracts';
import { authenticateRequest } from '../identity/controller';
import { errorStatus, transportError } from './transport-errors';

export class UsageService {
  private readonly pool: pg.Pool;
  constructor(databaseUrl: string) { this.pool = new pg.Pool({ connectionString: databaseUrl, max: 5 }); }
  async summary(userId: string): Promise<UsageSummary> {
    const result = await this.pool.query(`
      WITH day AS (SELECT (now() AT TIME ZONE 'UTC')::date AS value),
      usage AS (SELECT l.* FROM klaro.usage_ledger l JOIN klaro.budget_reservations r ON r.operation_id = l.operation_id, day WHERE l.user_id = $1 AND r.budget_day = day.value)
      SELECT to_char(day.value, 'YYYY-MM-DD') AS day,
        (SELECT count(*) FROM klaro.operations WHERE user_id = $1 AND (created_at AT TIME ZONE 'UTC')::date = day.value) AS operations,
        (SELECT count(*) FROM klaro.stage_attempts WHERE user_id = $1 AND dispatched_at IS NOT NULL AND (dispatched_at AT TIME ZONE 'UTC')::date = day.value) AS attempts,
        (SELECT COALESCE(json_agg(json_build_object('kind', usage_kind, 'input', input_tokens, 'output', output_tokens, 'cost', cost_microusd)), '[]') FROM usage) AS usage,
        (SELECT COALESCE(sum(remaining_tokens), 0) FROM klaro.budget_reservations WHERE user_id = $1 AND state IN ('reserved', 'unknown')) AS held_tokens,
        (SELECT COALESCE(sum(remaining_cost_microusd), 0) FROM klaro.budget_reservations WHERE user_id = $1 AND state IN ('reserved', 'unknown')) AS held_cost
      FROM day`, [userId]);
    const row = result.rows[0];
    const sum = (kind: string) => row.usage.filter((entry: { kind: string }) => entry.kind === kind).reduce((total: { inputTokens: number; outputTokens: number; costMicrousd: number }, entry: { input: number; output: number; cost: number }) => ({ inputTokens: total.inputTokens + Number(entry.input), outputTokens: total.outputTokens + Number(entry.output), costMicrousd: total.costMicrousd + Number(entry.cost) }), { inputTokens: 0, outputTokens: 0, costMicrousd: 0 });
    return UsageSummarySchema.parse({ version: 'v1', day: row.day, operations: Number(row.operations), providerAttempts: Number(row.attempts), actual: sum('actual'), estimated: sum('estimated'), heldTokens: Number(row.held_tokens), heldCostMicrousd: Number(row.held_cost) });
  }
  async close(): Promise<void> { await this.pool.end(); }
}
const usage = new UsageService(process.env['DATABASE_URL'] ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro');

@Controller('v1/me/usage')
export class UsageController {
  @Get()
  async summary(@Req() request: IncomingMessage, @Res() response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json');
    try { const actor = await authenticateRequest(request); response.end(JSON.stringify(await usage.summary(actor.userId))); }
    catch (error) { const detail = transportError(error); response.statusCode = errorStatus(detail); response.end(JSON.stringify(detail)); }
  }
}
