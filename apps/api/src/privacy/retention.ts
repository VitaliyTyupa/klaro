import pg from 'pg';
import { compactDeletionJournal } from './deletion-journal';
import { RETENTION } from './config';

export class RetentionService {
  private readonly pool: pg.Pool;
  constructor(databaseUrl: string) { this.pool = new pg.Pool({ connectionString: databaseUrl, max: 2 }); }
  async cleanup(now = new Date()): Promise<Record<string, number>> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN'); await connection.query('SELECT pg_advisory_xact_lock(81743004)');
      const cutoff = new Date(now.getTime() - RETENTION.metadataDays * 86400000); const counts: Record<string, number> = {};
      counts['digests'] = (await connection.query('UPDATE klaro.operations SET payload_digest = NULL WHERE payload_digest IS NOT NULL AND digest_expires_at <= $1', [now])).rowCount ?? 0;
      await connection.query('UPDATE klaro.operations SET parent_operation_id = NULL WHERE parent_operation_id IN (SELECT id FROM klaro.operations WHERE created_at <= $1)', [cutoff]);
      counts['operations'] = (await connection.query('DELETE FROM klaro.operations WHERE created_at <= $1', [cutoff])).rowCount ?? 0;
      counts['budgetAccounts'] = (await connection.query('DELETE FROM klaro.budget_accounts WHERE budget_day < $1::date', [cutoff])).rowCount ?? 0;
      counts['audit'] = (await connection.query('DELETE FROM klaro.admin_audit WHERE created_at <= $1', [cutoff])).rowCount ?? 0;
      counts['reports'] = (await connection.query('DELETE FROM klaro.reference_error_reports WHERE created_at <= $1', [cutoff])).rowCount ?? 0;
      counts['feedback'] = (await connection.query('DELETE FROM klaro.operation_feedback WHERE created_at <= $1', [cutoff])).rowCount ?? 0;
      counts['sessions'] = (await connection.query('DELETE FROM klaro.sessions WHERE expires_at <= $1', [cutoff])).rowCount ?? 0;
      counts['supplements'] = (await connection.query('DELETE FROM klaro.ai_supplements WHERE expires_at <= $1', [now])).rowCount ?? 0;
      counts['tombstones'] = (await connection.query('DELETE FROM klaro.account_deletion_tombstones WHERE retain_until <= $1 AND cleaned_at IS NOT NULL', [now])).rowCount ?? 0;
      await connection.query('COMMIT'); await compactDeletionJournal(now); return counts;
    } catch (error) { await connection.query('ROLLBACK'); throw error; } finally { connection.release(); }
  }
  async close(): Promise<void> { await this.pool.end(); }
}
