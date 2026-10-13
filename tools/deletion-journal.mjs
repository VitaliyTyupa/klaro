import { createDecipheriv } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
export async function readDeletionJournal(path, key) {
  if (!/^[a-fA-F0-9]{64}$/.test(key ?? '')) throw new Error('Invalid journal key');
  const contents = await readFile(path, 'utf8'); const records = [];
  for (const line of contents.split('\n').filter(Boolean)) {
    const envelope = JSON.parse(line); if (envelope.version !== 1 || !/^[a-f0-9]{24}$/.test(envelope.iv) || !/^[a-f0-9]{32}$/.test(envelope.tag) || typeof envelope.data !== 'string' || envelope.data.length > 2048) throw new Error('Invalid journal envelope');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(envelope.iv, 'hex')); decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
    const record = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
    if (!/^[a-f0-9-]{36}$/.test(record.userId) || !Number.isFinite(Date.parse(record.requestedAt)) || !Number.isFinite(Date.parse(record.retainUntil))) throw new Error('Invalid deletion record');
    records.push({ ...record, envelope: line });
  }
  return records;
}
export async function reapplyDeletions(databaseUrl, path, key, now = new Date()) {
  const records = (await readDeletionJournal(path, key)).filter(record => Date.parse(record.retainUntil) > now.getTime());
  const client = new pg.Client({ connectionString: databaseUrl }); await client.connect();
  try {
    await client.query('BEGIN');
    for (const record of records) {
      await client.query('DELETE FROM klaro.users WHERE id = $1', [record.userId]);
      await client.query('INSERT INTO klaro.account_deletion_tombstones (user_id,requested_at,cleaned_at,retain_until) VALUES ($1,$2,$4,$3) ON CONFLICT (user_id) DO UPDATE SET cleaned_at = excluded.cleaned_at, retain_until = greatest(klaro.account_deletion_tombstones.retain_until, excluded.retain_until)', [record.userId, record.requestedAt, record.retainUntil, now]);
    }
    await client.query('COMMIT'); return new Set(records.map(record => record.userId)).size;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { await client.end(); }
}
export async function compactJournal(path, key, now = new Date()) {
  const records = (await readDeletionJournal(path, key)).filter(record => Date.parse(record.retainUntil) > now.getTime());
  // Run offline, with deletion requests stopped, so a concurrent append cannot be lost.
  await writeFile(`${path}.next`, records.map(record => record.envelope + '\n').join(''), { mode: 0o600 }); await rename(`${path}.next`, path);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (process.argv[2] === 'reapply') console.info(JSON.stringify({ deletedAccounts: await reapplyDeletions(process.env.DATABASE_URL, process.env.DELETION_JOURNAL_FILE, process.env.DELETION_JOURNAL_KEY) })); else if (process.argv[2] === 'compact') await compactJournal(process.env.DELETION_JOURNAL_FILE, process.env.DELETION_JOURNAL_KEY); else throw new Error('Unknown command'); }
  catch { console.error('Deletion journal operation failed; keep application offline'); process.exitCode = 1; }
}
