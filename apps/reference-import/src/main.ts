import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { ReferenceRepository } from './repository';

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command, ...flags] = args;
  const options = Object.fromEntries(flags.map(flag => { const match = /^--([a-z-]+)=(.+)$/.exec(flag); if (!match) throw new Error('Options must use --name=value'); return [match[1], match[2]]; }));
  const required = (name: string): string => { const value = options[name]; if (!value) throw new Error(`Missing --${name}`); return value; };
  const repository = new ReferenceRepository(process.env['DATABASE_URL'] ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro');
  try {
    if (['import','validate','activate','rollback','takedown','revoke-source','check'].includes(command ?? '')) {
      const actor = process.env['ADMIN_ACTOR'] ?? (process.env['NODE_ENV'] === 'production' ? '' : 'local-operator');
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(actor)) throw new Error('Audited operator required');
      // CLI mutations require OS access to server-only database credentials; audit records the attempted action.
      const client = new pg.Client({ connectionString: process.env['DATABASE_URL'] ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro' });
      try { await client.connect(); await client.query('INSERT INTO klaro.admin_audit (actor, action) VALUES ($1,$2)', [actor, `reference-${command}`]); } finally { await client.end(); }
    }
    let result: unknown;
    switch (command) {
      case 'import': result = await repository.importFile(JSON.parse(await readFile(required('manifest'), 'utf8')), required('file')); break;
      case 'inspect': result = await repository.inspect(options['release']); break;
      case 'validate': await repository.validate(required('release')); result = { validated: true }; break;
      case 'activate': case 'rollback': await repository.activate(required('release')); result = { activated: true }; break;
      case 'takedown': await repository.takedown(required('source'), required('reason'), { nativeKey: options['native-key'], contentHash: options['hash'] }); result = { removed: true }; break;
      case 'revoke-source': await repository.revokeSource(required('source')); result = { revoked: true }; break;
      case 'check': result = await repository.checkUpdate(JSON.parse(await readFile(required('manifest'), 'utf8')), new Date(), options['if-due'] === 'true'); break;
      default: throw new Error('Use import, validate, activate, rollback, takedown, revoke-source or check');
    }
    if (options['report']) await writeFile(options['report'], `${JSON.stringify(result, null, 2)}\n`);
    console.info(JSON.stringify(result));
  } finally { await repository.close(); }
}
if (require.main === module) void main().catch(() => { console.error('Reference operation failed; check protected configuration and source admission'); process.exitCode = 1; });
