import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';
import { OperationFeedbackSchema } from '@klaro/contracts';
import type { AuthenticatedSession } from '../identity/sessions';
import { ApplicationError } from './errors';

export class FeedbackService {
  private readonly pool: pg.Pool;
  constructor(databaseUrl: string) { this.pool = new pg.Pool({ connectionString: databaseUrl, max: 2 }); }
  async submit(actor: AuthenticatedSession, operationId: string, body: unknown): Promise<{ received: true }> {
    const input = OperationFeedbackSchema.safeParse(body);
    if (!input.success || !z.uuid().safeParse(operationId).success) throw new ApplicationError('invalid-request');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query("SELECT id FROM klaro.users WHERE id = $1 AND status = 'active' FOR UPDATE", [actor.userId]);
      const session = await client.query('SELECT id FROM klaro.sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()', [actor.sessionId, actor.userId]);
      if (!user.rowCount || !session.rowCount) throw new ApplicationError('unauthenticated');
      const operation = await client.query('SELECT id FROM klaro.operations WHERE id = $1 AND user_id = $2 AND result_version > 0 FOR SHARE', [operationId, actor.userId]);
      if (!operation.rowCount) throw new ApplicationError('forbidden');
      const previous = await client.query('SELECT reason FROM klaro.operation_feedback WHERE user_id = $1 AND operation_id = $2', [actor.userId, operationId]);
      if (previous.rowCount) {
        if (previous.rows[0].reason !== input.data.reason) throw new ApplicationError('conflict');
      } else {
        const count = await client.query("SELECT count(*) FROM klaro.operation_feedback WHERE user_id = $1 AND created_at > now() - interval '24 hours'", [actor.userId]);
        if (Number(count.rows[0].count) >= 20) throw new ApplicationError('quota-exceeded');
        await client.query('INSERT INTO klaro.operation_feedback (id,user_id,operation_id,reason) VALUES ($1,$2,$3,$4)', [randomUUID(), actor.userId, operationId, input.data.reason]);
      }
      await client.query('COMMIT'); return { received: true };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async close(): Promise<void> { await this.pool.end(); }
}
