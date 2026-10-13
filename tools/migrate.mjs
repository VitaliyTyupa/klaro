import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro';

export async function migrate(connectionString = databaseUrl) {
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [81743001]);
    await client.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of readdirSync(directory).filter(name => /^\d+_[a-z_]+\.sql$/.test(name)).sort()) {
      const sql = readFileSync(resolve(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query('SELECT checksum FROM public.schema_migrations WHERE name = $1', [name]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error('Applied migration was modified');
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
      console.info(`Migration applied: ${name}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate().catch(() => {
    // Avoid leaking credentials or connection details from driver exceptions.
    console.error('Migration failed; check database availability and migration checksums');
    process.exitCode = 1;
  });
}
