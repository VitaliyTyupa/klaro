import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { ReferenceService } from '../dist/api/reference/service.js';
const url = process.env.DATABASE_URL ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro'; const pool = new pg.Pool({ connectionString: url }); const reference = new ReferenceService(url);
try {
  const release = (await pool.query("SELECT d.* FROM klaro.dataset_releases d JOIN klaro.active_dataset a ON a.release_id = d.id WHERE d.state = 'validated' AND d.import_complete")).rows[0]; assert.ok(release); assert.equal(release.source_id, 'kaikki-enwiktionary');
  const counts = {};
  for (const table of ['lexical_entries', 'lexical_senses', 'lexical_translations', 'lexical_examples', 'lexical_inflections', 'source_records']) counts[table] = Number((await pool.query(`SELECT count(*) FROM klaro.${table} WHERE release_id = $1`, [release.id])).rows[0].count);
  const invalid = Number((await pool.query("SELECT count(*) FROM klaro.source_records WHERE release_id = $1 AND (source_url = '' OR evidence_url = '' OR attribution = '' OR license <> 'CC-BY-SA-4.0' OR source_revision <> $2)", [release.id, release.source_revision])).rows[0].count); assert.equal(invalid, 0);
  const languages = Object.fromEntries((await pool.query('SELECT language, count(*) FROM klaro.lexical_entries WHERE release_id = $1 GROUP BY language', [release.id])).rows.map(row => [row.language, Number(row.count)])); assert.equal(Object.keys(languages).length, 4);
  const timings = []; const probes = [];
  for (const [language, query] of [['uk', 'дія'], ['de', 'gehen'], ['de', 'ging'], ['de', 'Bank'], ['en', 'bank'], ['vi', 'đã']]) {
    let candidates;
    for (let i = 0; i < 10; i++) { const start = performance.now(); candidates = (await reference.lookup(language, query)).candidates; timings.push(performance.now() - start); }
    assert.ok(candidates.length); probes.push({ language, query, candidates: candidates.length });
    const candidate = candidates[0]; const start = performance.now(); const card = await reference.card(candidate.id, release.id, 'uk'); assert.ok(card); await reference.availability(candidate.id, release.id); probes.at(-1).cardAndAvailabilityMs = performance.now() - start;
  }
  timings.sort((a, b) => a - b);
  const report = { evaluatedAt: new Date().toISOString(), releaseId: release.id, sourceRevision: release.source_revision, checksum: release.content_sha256, counts, languages, invalidProvenance: invalid, lookupLatencyMs: { samples: timings.length, median: timings[Math.floor(timings.length / 2)], p95: timings[Math.floor(timings.length * .95)], max: timings.at(-1) }, probes, coverage: release.coverage };
  await writeFile('docs/reference-full-verification.json', JSON.stringify(report, null, 2) + '\n'); console.info(JSON.stringify({ counts, languages, invalidProvenance: invalid, lookupLatencyMs: report.lookupLatencyMs }));
} finally { await reference.close(); await pool.end(); }
