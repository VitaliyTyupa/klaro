import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptBackup, decryptBackup } from '../tools/backup.mjs';
test('backup encryption authenticates before restore and rejects tampering without keeping plaintext', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'klaro-backup-')); const path = join(directory, 'backup.enc'); const output = join(directory, 'backup.sql'); const key = 'ab'.repeat(32); const source = 'Synthetic personal metadata backup';
  try { await encryptBackup(Readable.from(source), path, key); assert.equal((await readFile(path)).includes(Buffer.from(source)), false); await decryptBackup(path, output, key); assert.equal(await readFile(output, 'utf8'), source); await rm(output); const corrupt = await readFile(path); corrupt[corrupt.length - 1] ^= 1; await writeFile(path, corrupt); await assert.rejects(decryptBackup(path, output, key)); await assert.rejects(readFile(output), { code: 'ENOENT' }); }
  finally { await rm(directory, { recursive: true, force: true }); }
});
