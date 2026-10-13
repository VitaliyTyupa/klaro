import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { journalDeletion, compactDeletionJournal } from '../dist/api/privacy/deletion-journal.js';
import { readDeletionJournal } from '../tools/deletion-journal.mjs';
test('durable encrypted deletion journal serializes append/compaction and expires IDs after backup window', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'klaro-journal-')); const path = join(directory, 'journal.enc'); const key = randomBytes(32).toString('hex');
  process.env.DELETION_JOURNAL_FILE = path; process.env.DELETION_JOURNAL_KEY = key;
  const ids = Array.from({ length: 30 }, () => randomUUID());
  try {
    await Promise.all(ids.flatMap((id,index) => index % 3 ? [journalDeletion(id)] : [journalDeletion(id), compactDeletionJournal()]));
    const records = await readDeletionJournal(path,key); assert.deepEqual(records.map(record => record.userId).sort(), ids.sort());
    const encrypted = await readFile(path,'utf8'); assert.equal(ids.some(id => encrypted.includes(id)), false);
    const corrupt = encrypted.replace(/"tag":"([a-f0-9])/, (_match, digit) => `"tag":"${digit === '0' ? '1' : '0'}`); await writeFile(path,corrupt);
    await assert.rejects(compactDeletionJournal()); assert.equal(await readFile(path,'utf8'), corrupt);
    await writeFile(path,encrypted); await compactDeletionJournal(new Date(Date.now() + 36 * 86400000)); assert.deepEqual(await readDeletionJournal(path,key), []);
  } finally { delete process.env.DELETION_JOURNAL_FILE; delete process.env.DELETION_JOURNAL_KEY; await rm(directory,{ recursive: true, force: true }); }
});
