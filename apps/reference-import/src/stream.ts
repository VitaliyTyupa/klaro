import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';

export async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
export async function* readJsonLines(path: string): AsyncGenerator<unknown> {
  let lineBytes = 0;
  const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    for (const byte of chunk) { if (byte === 10) lineBytes = 0; else if (++lineBytes > 32 * 1024 * 1024) { callback(new Error('Source record exceeds 32 MiB')); return; } }
    callback(null, chunk);
  } });
  const source = createReadStream(path); const unzip = path.endsWith('.gz') ? createGunzip() : undefined;
  let streamError: unknown;
  const completion = (unzip ? pipeline(source, unzip, bounded) : pipeline(source, bounded)).catch(error => { streamError = error; bounded.destroy(error); });
  const lines = createInterface({ input: bounded, crlfDelay: Infinity });
  try { for await (const line of lines) { if (line.trim()) yield JSON.parse(line); } await completion; if (streamError) throw streamError; }
  finally { lines.close(); source.destroy(); unzip?.destroy(); bounded.destroy(); await completion; }
}
