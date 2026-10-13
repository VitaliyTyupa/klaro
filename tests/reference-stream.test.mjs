import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { readJsonLines } from '../apps/reference-import/src/stream.ts';
const directory = await mkdtemp(join(tmpdir(), 'klaro-stream-'));
try {
  const path = join(directory, 'data.jsonl.gz'); const bytes = gzipSync('{"word":"дія"}\n{"word":"đã"}\n');
  await writeFile(path, bytes); const rows = []; for await (const value of readJsonLines(path)) rows.push(value); assert.equal(rows.length, 2);
  await writeFile(path, bytes.subarray(0, bytes.length - 5)); await assert.rejects(async () => { for await (const value of readJsonLines(path)) void value; });
  await writeFile(path, gzipSync('{invalid}\n')); await assert.rejects(async () => { for await (const value of readJsonLines(path)) void value; });
} finally { await rm(directory, { recursive: true, force: true }); }
