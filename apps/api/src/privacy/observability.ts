import { randomBytes, timingSafeEqual } from 'node:crypto';
import pg from 'pg';
import type { IncomingMessage } from 'node:http';
import { ApplicationError } from '../operations/errors';

/** Only fixed enumerations and finite numbers may cross the logging boundary. */
export function safeLog(event: 'request' | 'startup-failed' | 'cleanup-failed', status = 0, durationMs = 0): string {
  const safeEvent = ['request', 'startup-failed', 'cleanup-failed'].includes(event) ? event : 'request';
  return JSON.stringify({ event: safeEvent, status: Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0, durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : 0 });
}
export const httpMetrics = { requests: 0, failures: 0, totalLatencyMs: 0, maximumLatencyMs: 0 };
export class OperationalControls {
  private readonly pool: pg.Pool;
  constructor(databaseUrl: string) { this.pool = new pg.Pool({ connectionString: databaseUrl, max: 2 }); }
  async enabled(): Promise<boolean> { return (await this.pool.query('SELECT ai_enabled FROM klaro.operational_controls WHERE singleton')).rows[0]?.ai_enabled === true; }
  async initialize(): Promise<void> { if (process.env['AI_ENABLED'] === 'false') await this.pool.query('UPDATE klaro.operational_controls SET ai_enabled = false, updated_at = now() WHERE singleton'); }
  async setEnabled(enabled: boolean, actor: string): Promise<void> {
    const connection = await this.pool.connect();
    try { await connection.query('BEGIN'); await connection.query('UPDATE klaro.operational_controls SET ai_enabled = $1, updated_at = now() WHERE singleton', [enabled]); await connection.query('INSERT INTO klaro.admin_audit (actor, action) VALUES ($1,$2)', [actor, enabled ? 'ai-enabled' : 'ai-disabled']); await connection.query('COMMIT'); }
    catch (error) { await connection.query('ROLLBACK'); throw error; } finally { connection.release(); }
  }
  async metrics(actor: string): Promise<unknown> {
    const operations = (await this.pool.query("SELECT count(*) AS operations, count(*) FILTER (WHERE error_code IS NOT NULL) AS failures, COALESCE(avg(extract(epoch FROM (completed_at - created_at))*1000) FILTER (WHERE completed_at IS NOT NULL),0) AS average_latency_ms, COALESCE(max(extract(epoch FROM (completed_at - created_at))*1000),0) AS maximum_latency_ms FROM klaro.operations WHERE created_at > now() - interval '1 day'")).rows[0];
    const usage = (await this.pool.query("SELECT usage_kind, sum(input_tokens + output_tokens) AS tokens, sum(cost_microusd) AS cost_microusd FROM klaro.usage_ledger WHERE settled_at > now() - interval '1 day' GROUP BY usage_kind")).rows;
    await this.pool.query("INSERT INTO klaro.admin_audit (actor, action) VALUES ($1, 'metrics-read')", [actor]);
    return { http: { ...httpMetrics }, operations, usage, aiEnabled: await this.enabled(), windowHours: 24 };
  }
  async close(): Promise<void> { await this.pool.end(); }
}
export function authenticateOperator(request: IncomingMessage): string {
  const configured = process.env['ADMIN_TOKEN']; const actor = process.env['ADMIN_ACTOR'];
  const candidate = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
  // Fixed length comparison never logs supplied secrets or headers.
  const dummy = randomBytes(32).toString('hex'); const expected = configured && /^[a-f0-9]{64}$/.test(configured) ? configured : dummy;
  const valid = /^[a-f0-9]{64}$/.test(candidate) && timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
  if (!configured || !valid || !actor || !/^[a-zA-Z0-9_-]{1,128}$/.test(actor)) throw new ApplicationError('forbidden');
  return actor;
}
