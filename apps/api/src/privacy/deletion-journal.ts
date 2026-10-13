import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

let pending: Promise<unknown> = Promise.resolve();
function exclusive<T>(action: () => Promise<T>): Promise<T> { const result = pending.then(action); pending = result.catch(() => {}); return result; }

/** Fsync outside the database backup boundary before acknowledging deletion. */
async function appendDeletion(userId: string): Promise<void> {
  const path = process.env['DELETION_JOURNAL_FILE']; const key = process.env['DELETION_JOURNAL_KEY'];
  if (!path || !key) { if (process.env['NODE_ENV'] === 'production') throw new Error('Deletion journal not configured'); return; }
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('Invalid deletion journal key');
  const now = new Date(); const record = JSON.stringify({ userId, requestedAt: now.toISOString(), retainUntil: new Date(now.getTime() + 35 * 86400000).toISOString() });
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv); const encrypted = Buffer.concat([cipher.update(record, 'utf8'), cipher.final()]);
  const line = JSON.stringify({ version: 1, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: encrypted.toString('base64') }) + '\n';
  await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const file = await open(path, 'a', 0o600);
  try { await file.write(line); await file.sync(); const directory = await open(dirname(path), 'r'); try { await directory.sync(); } finally { await directory.close(); } } finally { await file.close(); }
}

export function journalDeletion(userId: string): Promise<void> { return exclusive(() => appendDeletion(userId)); }
export function compactDeletionJournal(now = new Date()): Promise<void> {
  return exclusive(async () => {
    const path = process.env['DELETION_JOURNAL_FILE']; const key = process.env['DELETION_JOURNAL_KEY'];
    if (!path || !key) return;
    let content: string;
    try { content = await readFile(path, 'utf8'); } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return; throw error; }
    const retained: string[] = [];
    for (const line of content.split('\n').filter(Boolean)) {
      const envelope = JSON.parse(line) as { iv: string; tag: string; data: string };
      const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(envelope.iv, 'hex')); decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
      const record = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8')) as { retainUntil: string };
      const deadline = Date.parse(record.retainUntil); if (!Number.isFinite(deadline)) throw new Error('Invalid journal');
      if (deadline > now.getTime()) retained.push(line);
    }
    await writeFile(`${path}.next`, retained.map(line => line + '\n').join(''), { mode: 0o600 });
    const file = await open(`${path}.next`, 'r'); try { await file.sync(); } finally { await file.close(); }
    await rename(`${path}.next`, path); const directory = await open(dirname(path), 'r'); try { await directory.sync(); } finally { await directory.close(); }
  });
}
