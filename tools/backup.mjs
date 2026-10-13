import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, link, open, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createClient } from 'redis';
import { readDeletionJournal, reapplyDeletions } from './deletion-journal.mjs';
const magic = Buffer.from('KLARO-BACKUP-1\n');
function encryptionKey(key) { if (!/^[a-fA-F0-9]{64}$/.test(key ?? '')) throw new Error('Backup encryption key required'); return Buffer.from(key, 'hex'); }
export async function encryptBackup(input, path, key) {
  const temporary = `${path}.partial`; const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey(key), iv);
  try {
    const file = await open(temporary, 'wx', 0o600); try { await file.write(Buffer.concat([magic, iv])); } finally { await file.close(); }
    await pipeline(input, cipher, createWriteStream(temporary, { flags: 'a', mode: 0o600 })); await appendFile(temporary, cipher.getAuthTag()); await link(temporary, path); await rm(temporary);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
}
export async function decryptBackup(path, output, key) {
  const size = (await stat(path)).size; const headerSize = magic.length + 12;
  if (size < headerSize + 16) throw new Error('Invalid backup'); const file = await open(path, 'r'); const header = Buffer.alloc(headerSize); const tag = Buffer.alloc(16);
  try { await file.read(header, 0, headerSize, 0); await file.read(tag, 0, 16, size - 16); } finally { await file.close(); }
  if (!header.subarray(0, magic.length).equals(magic)) throw new Error('Invalid backup version');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(key), header.subarray(magic.length)); decipher.setAuthTag(tag);
  try { await pipeline(createReadStream(path, { start: headerSize, end: size - 17 }), decipher, createWriteStream(output, { flags: 'wx', mode: 0o600 })); }
  catch (error) { await rm(output, { force: true }); throw error; }
}
function dockerProcess(args) {
  const child = spawn('docker', ['compose', 'exec', '-T', 'postgres', ...args], { stdio: ['pipe', 'pipe', 'ignore'] });
  const done = new Promise((resolve, reject) => { child.on('error', () => reject(new Error('Database tool failed'))); child.on('exit', code => code === 0 ? resolve() : reject(new Error('Database tool failed'))); });
  // Observe early process failures while a pipeline is still running.
  void done.catch(() => {}); return { child, done };
}
export async function clearRestoredPrivateState(databaseUrl, redisUrl) {
  const client = new pg.Client({ connectionString: databaseUrl }); await client.connect();
  try { await client.query('UPDATE klaro.sessions SET revoked_at = now() WHERE revoked_at IS NULL'); await client.query('UPDATE klaro.operations SET payload_digest = NULL'); await client.query('UPDATE klaro.operational_controls SET ai_enabled = false, updated_at = now() WHERE singleton'); }
  finally { await client.end(); }
  const redis = createClient({ url: redisUrl }); redis.on('error', () => {}); await redis.connect();
  try { for await (const keys of redis.scanIterator({ MATCH: 'klaro:payload:*', COUNT: 100 })) if (keys.length) await redis.del(keys); } finally { await redis.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[3]; let temporary;
  try {
    if (!path) throw new Error('Backup path required'); const database = new URL(process.env.DATABASE_URL ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro').pathname.slice(1);
    if (!/^[a-zA-Z0-9_]+$/.test(database)) throw new Error('Invalid database');
    if (process.argv[2] === 'create') { const { child, done } = dockerProcess(['pg_dump', '-U', 'klaro', '-d', database, '--format=custom']); child.stdin.end(); await encryptBackup(child.stdout, path, process.env.BACKUP_KEY); try { await done; } catch (error) { await rm(path, { force: true }); throw error; } }
    else if (process.argv[2] === 'restore') {
      if (process.env.RESTORE_OFFLINE !== 'true' || !process.env.DELETION_JOURNAL_FILE || !process.env.DELETION_JOURNAL_KEY) throw new Error('Offline restore and current deletion journal required');
      await readDeletionJournal(process.env.DELETION_JOURNAL_FILE, process.env.DELETION_JOURNAL_KEY);
      temporary = `${path}.restore-${randomBytes(8).toString('hex')}`; await decryptBackup(path, temporary, process.env.BACKUP_KEY);
      const { child, done } = dockerProcess(['pg_restore', '-U', 'klaro', '-d', database, '--clean', '--if-exists', '--exit-on-error']); await pipeline(createReadStream(temporary), child.stdin); await done;
      await reapplyDeletions(process.env.DATABASE_URL, process.env.DELETION_JOURNAL_FILE, process.env.DELETION_JOURNAL_KEY);
      await clearRestoredPrivateState(process.env.DATABASE_URL, process.env.REDIS_URL ?? 'redis://127.0.0.1:6380');
    } else throw new Error('Unknown command');
    console.info(JSON.stringify({ event: 'backup-operation-completed' }));
  } catch { console.error('Backup operation failed; keep application offline and check protected configuration'); process.exitCode = 1; }
  finally { if (temporary) await rm(temporary, { force: true }); }
}
