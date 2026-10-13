import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import pg from 'pg';

function hash(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export interface AuthenticatedSession {
  sessionId: string;
  userId: string;
  clientKind: 'web' | 'extension';
  csrfHash: Buffer | null;
  expiresAt: Date;
}

export class SessionService {
  private readonly pool: pg.Pool;
  constructor(connectionString: string, private readonly now: () => number = Date.now) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
  }

  async signIn(identity: { issuer: string; subject: string }, clientKind: 'web' | 'extension' = 'web'): Promise<{ token: string; csrfToken: string; userId: string; expiresAt: Date }> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const identityKey = `${identity.issuer.length}:${identity.issuer}${identity.subject}`;
      await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [identityKey]);
      const existing = await connection.query<{ id: string; status: string }>('SELECT u.id, u.status FROM klaro.users u JOIN klaro.external_identities i ON i.user_id = u.id WHERE i.issuer = $1 AND i.subject = $2', [identity.issuer, identity.subject]);
      let userId = existing.rows[0]?.id;
      if (existing.rows[0] && existing.rows[0].status !== 'active') throw new Error('Account unavailable');
      if (!userId) {
        userId = randomUUID();
        await connection.query('INSERT INTO klaro.users (id) VALUES ($1)', [userId]);
        await connection.query('INSERT INTO klaro.external_identities (id, user_id, issuer, subject) VALUES ($1, $2, $3, $4)', [randomUUID(), userId, identity.issuer, identity.subject]);
        await connection.query('INSERT INTO klaro.user_preferences (user_id) VALUES ($1)', [userId]);
      }
      const token = randomBytes(32).toString('base64url');
      const csrfToken = randomBytes(32).toString('base64url');
      const createdAt = new Date(this.now());
      const expiresAt = new Date(this.now() + (clientKind === 'web' ? 28800000 : 900000));
      await connection.query('INSERT INTO klaro.sessions (id, user_id, token_hash, csrf_hash, client_kind, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [randomUUID(), userId, hash(token), clientKind === 'web' ? hash(csrfToken) : null, clientKind, createdAt, expiresAt]);
      await connection.query('COMMIT');
      return { token, csrfToken, userId, expiresAt };
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally { connection.release(); }
  }

  async authenticate(token: string, clientKind: 'web' | 'extension'): Promise<AuthenticatedSession | undefined> {
    if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) return undefined;
    const result = await this.pool.query<{ id: string; user_id: string; client_kind: 'web' | 'extension'; csrf_hash: Buffer | null; expires_at: Date }>(
      "SELECT s.id, s.user_id, s.client_kind, s.csrf_hash, s.expires_at FROM klaro.sessions s JOIN klaro.users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.client_kind = $2 AND s.revoked_at IS NULL AND s.expires_at > $3 AND u.status = 'active'", [hash(token), clientKind, new Date(this.now())],
    );
    const row = result.rows[0];
    return row ? { sessionId: row.id, userId: row.user_id, clientKind: row.client_kind, csrfHash: row.csrf_hash, expiresAt: row.expires_at } : undefined;
  }

  validateCsrf(session: AuthenticatedSession, token: string): boolean {
    return session.csrfHash !== null && token.length <= 128 && timingSafeEqual(session.csrfHash, hash(token));
  }

  async revoke(session: AuthenticatedSession): Promise<void> {
    await this.pool.query('UPDATE klaro.sessions SET revoked_at = $1 WHERE id = $2 AND user_id = $3', [new Date(this.now()), session.sessionId, session.userId]);
  }

  async revokeAll(userId: string): Promise<void> {
    await this.pool.query('UPDATE klaro.sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL', [new Date(this.now()), userId]);
  }

  async close(): Promise<void> { await this.pool.end(); }
}
