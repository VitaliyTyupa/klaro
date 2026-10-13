import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PolicyRegistry } from '../dist/api/ai/policies.js';
export async function activatePolicy(path, version, databaseUrl, actor) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(actor ?? '')) throw new Error('Audited operator required');
  const configuration = JSON.parse(await readFile(path, 'utf8')); const provider = configuration.policies[0]?.model.provider;
  if (process.env.NODE_ENV === 'production' && provider === 'double') throw new Error('Synthetic policy forbidden in production');
  const registry = new PolicyRegistry(configuration.policies, configuration.active, provider); registry.activate(version);
  const client = new pg.Client({ connectionString: databaseUrl }); await client.connect();
  try { await client.query("INSERT INTO klaro.admin_audit (actor, action) VALUES ($1,'model-activate')", [actor]); }
  finally { await client.end(); }
  // Operator keeps the API stopped while replacing the immutable-policy pointer file.
  await writeFile(`${path}.next`, JSON.stringify({ ...configuration, active: version }, null, 2) + '\n', { mode: 0o600 }); await rename(`${path}.next`, path);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (process.env.RESTORE_OFFLINE !== 'true') throw new Error('Stop application first'); await activatePolicy(process.env.AI_POLICY_FILE, process.argv[2], process.env.DATABASE_URL, process.env.ADMIN_ACTOR); console.info('Model policy pointer changed; review evidence before enabling processing'); }
  catch { console.error('Policy activation failed; keep processing disabled'); process.exitCode = 1; }
}
