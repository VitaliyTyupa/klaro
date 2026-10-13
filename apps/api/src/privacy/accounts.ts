import pg from 'pg';
import type { AuthenticatedSession } from '../identity/sessions';
import { ApplicationError } from '../operations/errors';
import { journalDeletion } from './deletion-journal';
import type { PayloadStore } from '../operations/payloads';

export class AccountPrivacyService {
  private readonly pool: pg.Pool;
  constructor(databaseUrl: string, private readonly payloads: PayloadStore, private readonly abortUser: (userId: string) => Promise<void> = async () => {}) { this.pool = new pg.Pool({ connectionString: databaseUrl, max: 3 }); }
  private async active(connection: pg.PoolClient, actor: AuthenticatedSession, exclusive = false): Promise<void> {
    const user = await connection.query(`SELECT id FROM klaro.users WHERE id = $1 AND status = 'active' FOR ${exclusive ? 'UPDATE' : 'SHARE'}`, [actor.userId]);
    const session = await connection.query('SELECT id FROM klaro.sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()', [actor.sessionId, actor.userId]);
    if (!user.rowCount || !session.rowCount) throw new ApplicationError('unauthenticated');
  }
  async export(actor: AuthenticatedSession): Promise<unknown> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ'); await this.active(connection, actor);
      const data: Record<string, unknown> = {};
      data['profile'] = (await connection.query('SELECT * FROM klaro.users WHERE id = $1', [actor.userId])).rows[0];
      for (const table of ['external_identities', 'user_preferences', 'operations', 'stage_attempts', 'usage_ledger', 'budget_reservations', 'budget_accounts', 'reference_error_reports', 'operation_feedback']) {
        data[table] = (await connection.query(`SELECT * FROM klaro.${table} WHERE user_id = $1`, [actor.userId])).rows.map(row => ({ ...row, ...(row.payload_digest ? { payload_digest: (row.payload_digest as Buffer).toString('hex') } : {}) }));
      }
      data['sessions'] = (await connection.query('SELECT id, user_id, client_kind, created_at, expires_at, revoked_at FROM klaro.sessions WHERE user_id = $1', [actor.userId])).rows;
      const temporary = [];
      for (const row of data['operations'] as { id: string }[]) { const payload = await this.payloads.get(actor.userId, row.id); if (payload) temporary.push({ operationId: row.id, ...payload }); }
      await connection.query('COMMIT');
      return { format: 'klaro-account-export-v1', exportedAt: new Date().toISOString(), data, temporaryPayloads: temporary, notice: 'Temporary payloads are included only while available. There is no permanent text history. Authentication secret hashes are excluded.' };
    } catch (error) { await connection.query('ROLLBACK'); throw error; } finally { connection.release(); }
  }
  async delete(actor: AuthenticatedSession): Promise<{ accepted: true; activeCleanupDays: 7; backupExpiryDays: 30 }> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN'); await this.active(connection, actor, true);
      await journalDeletion(actor.userId);
      await connection.query("UPDATE klaro.users SET status = 'deleting', updated_at = now() WHERE id = $1", [actor.userId]);
      await connection.query('INSERT INTO klaro.account_deletion_tombstones (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [actor.userId]);
      await connection.query('UPDATE klaro.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [actor.userId]);
      await connection.query("UPDATE klaro.operations SET payload_digest = NULL, cancel_requested_at = now(), status = CASE WHEN completed_at IS NULL THEN 'cancelled' ELSE status END WHERE user_id = $1", [actor.userId]);
      await connection.query('COMMIT');
    } catch (error) { await connection.query('ROLLBACK'); throw error; } finally { connection.release(); }
    await this.clean(actor.userId).catch(() => { /* Persisted tombstone retries cleanup; account remains inaccessible. */ });
    return { accepted: true, activeCleanupDays: 7, backupExpiryDays: 30 };
  }
  private async clean(userId: string): Promise<void> {
    await this.abortUser(userId); await this.payloads.deleteUser(userId);
    const connection = await this.pool.connect();
    try { await connection.query('BEGIN'); await connection.query('DELETE FROM klaro.users WHERE id = $1', [userId]); await connection.query('UPDATE klaro.account_deletion_tombstones SET cleaned_at = now() WHERE user_id = $1', [userId]); await connection.query('COMMIT'); }
    catch (error) { await connection.query('ROLLBACK'); throw error; } finally { connection.release(); }
  }
  async retryDeletions(): Promise<void> {
    const pending = await this.pool.query('SELECT user_id FROM klaro.account_deletion_tombstones WHERE cleaned_at IS NULL');
    for (const row of pending.rows) await this.clean(row.user_id);
  }
  async close(): Promise<void> { await this.pool.end(); }
}
