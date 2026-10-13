import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { admitSource, contentHash, type SourceManifest } from './admission';
import { emptyCoverage, emptyRows, mapEntry, TABLES, type Coverage } from './mapper';
import { fileHash, readJsonLines } from './stream';

const LOCK = 81743003;
export class ReferenceRepository {
  private readonly pool: pg.Pool;
  constructor(databaseUrl: string, private readonly allowSynthetic = false) { this.pool = new pg.Pool({ connectionString: databaseUrl, max: 3 }); }
  async close(): Promise<void> { await this.pool.end(); }
  private async transaction<T>(action: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK]); const result = await action(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async importFile(input: unknown, path: string, options: { batchSize?: number; afterBatch?: (batch: number) => void } = {}): Promise<{ releaseId: string; coverage: Coverage; noOp: boolean }> {
    const manifest = admitSource(input, this.allowSynthetic);
    if (!manifest.sha256 || await fileHash(path) !== manifest.sha256) throw new Error('Pinned source checksum is required and must match');
    const batchSize = options.batchSize ?? 100;
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error('Invalid batch size');
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [LOCK]);
      const existing = (await client.query('SELECT * FROM klaro.dataset_releases WHERE source_id = $1 AND source_revision = $2 AND content_sha256 = $3', [manifest.sourceId, manifest.sourceRevision, manifest.sha256])).rows[0];
      if (existing && (contentHash(existing.manifest) !== contentHash(manifest) || existing.state === 'revoked')) throw new Error('Release manifest conflicts or rights are revoked');
      const releaseId: string = existing?.id ?? randomUUID();
      if (existing?.import_complete) return { releaseId, coverage: existing.coverage, noOp: true };
      if (!existing) await client.query("INSERT INTO klaro.dataset_releases (id, source_id, source_revision, content_sha256, manifest, state) VALUES ($1, $2, $3, $4, $5, 'staging')", [releaseId, manifest.sourceId, manifest.sourceRevision, manifest.sha256, JSON.stringify(manifest)]);
      const coverage = emptyCoverage(); let rows = emptyRows(); let count = 0; let batch = 0;
      const flush = async (): Promise<void> => {
        await client.query('BEGIN');
        try {
          for (const table of TABLES) if (rows[table].length) await client.query(`INSERT INTO klaro.${table} SELECT * FROM jsonb_populate_recordset(NULL::klaro.${table}, $1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(rows[table])]);
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        rows = emptyRows(); count = 0; options.afterBatch?.(++batch);
      };
      for await (const raw of readJsonLines(path)) {
        coverage.lines++;
        // Non-catalog records do not need parsing into the catalog-specific shape.
        if (raw && typeof raw === 'object' && !manifest.languages.includes((raw as { lang_code: SourceManifest['languages'][number] }).lang_code)) { coverage.ignoredLanguages++; continue; }
        const mapped = mapEntry(raw, manifest, releaseId, coverage);
        for (const table of TABLES) rows[table].push(...mapped[table]);
        if (++count >= batchSize || rows.source_records.length >= 10000) await flush();
      }
      if (count) await flush();
      const distinct = Number((await client.query('SELECT count(*) FROM klaro.lexical_entries WHERE release_id = $1', [releaseId])).rows[0].count);
      coverage.duplicates = coverage.importedEntries - distinct; coverage.importedEntries = distinct;
      // Count stored content, so duplicate source lines cannot inflate coverage.
      const grouped = async (sql: string): Promise<Record<string, number>> => Object.fromEntries((await client.query(sql, [releaseId])).rows.map(row => [row.key, Number(row.count)]));
      coverage.partsOfSpeech = await grouped("SELECT language || ':' || part_of_speech AS key, count(*) FROM klaro.lexical_entries WHERE release_id = $1 GROUP BY key");
      coverage.translationLanguages = await grouped("SELECT e.language || ':' || t.language AS key, count(*) FROM klaro.lexical_translations t JOIN klaro.lexical_entries e ON e.id = t.entry_id WHERE t.release_id = $1 GROUP BY key");
      coverage.sections = await grouped(`SELECT key, sum(count) AS count FROM (
        SELECT e.language || ':definitions' AS key, count(*) FROM klaro.lexical_senses s JOIN klaro.lexical_entries e ON e.id = s.entry_id WHERE s.release_id = $1 AND cardinality(s.glosses) > 0 GROUP BY key
        UNION ALL SELECT e.language || ':forms' AS key, count(*) FROM klaro.lexical_inflections f JOIN klaro.lexical_entries e ON e.id = f.entry_id WHERE f.release_id = $1 GROUP BY key
        UNION ALL SELECT e.language || ':examples' AS key, count(*) FROM klaro.lexical_examples x JOIN klaro.lexical_senses s ON s.id = x.sense_id JOIN klaro.lexical_entries e ON e.id = s.entry_id WHERE x.release_id = $1 GROUP BY key
      ) sections GROUP BY key`);
      await client.query('UPDATE klaro.dataset_releases SET import_complete = true, coverage = $2 WHERE id = $1', [releaseId, JSON.stringify(coverage)]);
      return { releaseId, coverage, noOp: false };
    } finally { try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK]); } finally { client.release(); } }
  }

  async inspect(releaseId?: string): Promise<unknown> {
    const releases = (await this.pool.query('SELECT id, source_id, source_revision, state, import_complete, coverage FROM klaro.dataset_releases WHERE ($1::uuid IS NULL OR id = $1) ORDER BY created_at DESC', [releaseId ?? null])).rows;
    const active = (await this.pool.query('SELECT release_id FROM klaro.active_dataset')).rows[0]?.release_id ?? null;
    if (!releaseId) return { releases, active };
    const counts: Record<string, number> = {};
    for (const table of TABLES) counts[table] = Number((await this.pool.query(`SELECT count(*) FROM klaro.${table} WHERE release_id = $1`, [releaseId])).rows[0].count);
    const languages = Object.fromEntries((await this.pool.query('SELECT language, count(*) FROM klaro.lexical_entries WHERE release_id = $1 GROUP BY language', [releaseId])).rows.map(row => [row.language, Number(row.count)]));
    const started = performance.now();
    const lookup = await this.pool.query("SELECT id FROM klaro.lexical_entries WHERE release_id = $1 AND language = 'de' AND normalized_lemma = 'gehen'", [releaseId]);
    return { releases, active, counts, languages, lookup: { milliseconds: performance.now() - started, candidates: lookup.rowCount } };
  }

  async validate(releaseId: string): Promise<void> {
    await this.transaction(async client => {
      const release = (await client.query('SELECT * FROM klaro.dataset_releases WHERE id = $1 FOR UPDATE', [releaseId])).rows[0];
      if (!release || !release.import_complete || release.state === 'revoked') throw new Error('Release is incomplete or unavailable');
      const manifest = admitSource(release.manifest, this.allowSynthetic);
      if (manifest.sha256 !== release.content_sha256) throw new Error('Release checksum does not match manifest');
      const languages = (await client.query('SELECT DISTINCT language FROM klaro.lexical_entries WHERE release_id = $1', [releaseId])).rows.map(row => row.language);
      if (!manifest.languages.every(language => languages.includes(language)) || languages.some(language => !manifest.languages.includes(language))) throw new Error('Release language coverage is incomplete');
      const invalid = (await client.query("SELECT count(*) FROM klaro.source_records WHERE release_id = $1 AND (source_revision <> $2 OR source_url = '' OR attribution = '' OR evidence_url = '' OR license NOT IN ('CC-BY-SA-4.0', 'CC0-1.0'))", [releaseId, manifest.sourceRevision])).rows[0];
      const exampleEvidence = (await client.query('SELECT p.content_hash, p.license, p.evidence_url, p.attribution FROM klaro.lexical_examples x JOIN klaro.source_records p ON p.id = x.source_record_id WHERE x.release_id = $1', [releaseId])).rows;
      if (exampleEvidence.some(row => !manifest.exampleEvidence.some(item => item.contentHash === row.content_hash && item.license === row.license && item.evidenceUrl === row.evidence_url && item.attribution === row.attribution))) throw new Error('Example rights are not admitted');
      const conflicting = (await client.query("SELECT count(*) FROM klaro.source_records WHERE release_id = $1 AND fragment_path NOT LIKE '%/examples/%' AND (license <> $2 OR evidence_url <> $3 OR attribution <> $4 OR license_url <> $5)", [releaseId, manifest.license, manifest.rightsEvidenceUrl, manifest.attribution, manifest.licenseUrl])).rows[0];
      if (Number(conflicting.count)) throw new Error('Source rights provenance conflicts');
      if (Number(invalid.count)) throw new Error('Release provenance validation failed');
      await client.query("UPDATE klaro.dataset_releases SET state = 'validated', validated_at = now() WHERE id = $1", [releaseId]);
    });
  }
  async activate(releaseId: string): Promise<void> {
    await this.transaction(async client => {
      const release = (await client.query("SELECT * FROM klaro.dataset_releases WHERE id = $1 AND state = 'validated' AND import_complete FOR UPDATE", [releaseId])).rows[0];
      if (!release) throw new Error('Only a validated complete release may be activated');
      const manifest = admitSource(release.manifest, this.allowSynthetic);
      if (manifest.sha256 !== release.content_sha256) throw new Error('Release checksum does not match manifest');
      // Tombstones apply through the view even when an old release is activated.
      await client.query('INSERT INTO klaro.active_dataset (singleton, release_id) VALUES (true, $1) ON CONFLICT (singleton) DO UPDATE SET release_id = excluded.release_id, activated_at = now()', [releaseId]);
    });
  }
  async takedown(sourceId: string, reason: string, selector: { nativeKey?: string; contentHash?: string }): Promise<void> {
    if (!selector.nativeKey && !selector.contentHash || !/^[a-z][a-z0-9-]{0,127}$/.test(reason) || selector.contentHash && !/^[a-f0-9]{64}$/.test(selector.contentHash)) throw new Error('Invalid takedown');
    await this.transaction(async client => { await client.query('INSERT INTO klaro.reference_takedowns (id, source_id, native_key, content_hash, reason) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), sourceId, selector.nativeKey ?? null, selector.contentHash ?? null, reason]); });
  }
  async revokeSource(sourceId: string): Promise<void> {
    await this.transaction(async client => { await client.query("UPDATE klaro.dataset_releases SET state = 'revoked' WHERE source_id = $1", [sourceId]); await client.query('DELETE FROM klaro.active_dataset WHERE release_id IN (SELECT id FROM klaro.dataset_releases WHERE source_id = $1)', [sourceId]); });
  }
  async checkUpdate(input: unknown, now = new Date(), onlyIfDue = false, request: typeof fetch = fetch): Promise<{ checked: boolean; changed: boolean }> {
    const manifest = admitSource(input, this.allowSynthetic);
    const previous = (await this.pool.query('SELECT * FROM klaro.reference_update_checks WHERE source_id = $1', [manifest.sourceId])).rows[0];
    if (onlyIfDue && previous && now.getTime() - new Date(previous.checked_at).getTime() < 28 * 86400000) return { checked: false, changed: previous.changed };
    const response = await request(manifest.metadataUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Source metadata check failed');
    const html = await response.text(); if (html.length > 2000000) throw new Error('Source metadata exceeds limit');
    const hash = contentHash(html); const changed = Boolean(previous && (previous.changed || previous.metadata_sha256 !== hash));
    await this.pool.query('INSERT INTO klaro.reference_update_checks (source_id, checked_at, metadata_sha256, changed) VALUES ($1, $2, $3, $4) ON CONFLICT (source_id) DO UPDATE SET checked_at = excluded.checked_at, metadata_sha256 = excluded.metadata_sha256, changed = excluded.changed', [manifest.sourceId, now, hash, changed]);
    return { checked: true, changed };
  }
}
