import pg from 'pg';
import { normalizeReferenceForm, type ReferenceCandidate, type ReferenceLanguage, type ReferenceLookup, type ReferenceCard, type ReferenceProvenance, type ReferenceSection, type ReferenceSectionData } from '@klaro/contracts';
import { applicableSections, matchesSection } from './sections';
type Row = Record<string, unknown>;
const candidate = (row: Row): ReferenceCandidate => ({ id: String(row['id']), sourceVersion: String(row['release_id']), language: row['language'] as ReferenceLanguage, lemma: String(row['lemma']), partOfSpeech: String(row['part_of_speech']), homonymKey: String(row['homonym_key']), ...(typeof row['preview'] === 'string' ? { preview: row['preview'].slice(0, 160) } : {}) });
const provenance = (row: Row): ReferenceProvenance => ({ id: String(row['provenance_id']), url: String(row['source_url']), revision: String(row['source_revision']), license: String(row['license']), licenseUrl: String(row['license_url']), attribution: String(row['attribution']), evidenceUrl: String(row['evidence_url']) });
const PROVENANCE = 'p.id AS provenance_id, p.source_url, p.source_revision, p.license, p.license_url, p.attribution, p.evidence_url';
export class ReferenceService {
  private readonly pool: pg.Pool;
  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url, max: 5 }); }
  async close(): Promise<void> { await this.pool.end(); }
  async lookup(language: ReferenceLanguage, query: string, offset = 0): Promise<ReferenceLookup> {
    const result = await this.pool.query(`WITH matches AS (SELECT e.id FROM klaro.lexical_entries e JOIN klaro.active_dataset a ON a.release_id = e.release_id WHERE e.language = $1 AND e.normalized_lemma = $2 UNION SELECT f.entry_id FROM klaro.lexical_inflections f JOIN klaro.active_dataset a ON a.release_id = f.release_id JOIN klaro.lexical_entries e ON e.id = f.entry_id AND e.language = $1 WHERE f.normalized_form = $2) SELECT e.*, (SELECT s.glosses[1] FROM klaro.lexical_senses s WHERE s.entry_id = e.id ORDER BY s.position LIMIT 1) AS preview FROM matches m JOIN klaro.admitted_lexical_entries e ON e.id = m.id ORDER BY e.lemma, e.part_of_speech, e.homonym_key, e.id LIMIT 51 OFFSET $3`, [language, normalizeReferenceForm(language, query), offset]);
    return { version: 'v1', candidates: result.rows.slice(0, 50).map(candidate), nextOffset: result.rows.length > 50 ? offset + 50 : null };
  }
  private async entry(id: string, version: string): Promise<Row | undefined> {
    return (await this.pool.query(`SELECT e.*, ${PROVENANCE} FROM klaro.admitted_lexical_entries e JOIN klaro.source_records p ON p.id = e.source_record_id WHERE e.id = $1 AND e.release_id = $2`, [id, version])).rows[0];
  }
  async card(id: string, version: string, native: ReferenceLanguage, offset = 0): Promise<ReferenceCard | undefined> {
    const entry = await this.entry(id, version); if (!entry) return undefined;
    const senses = (await this.pool.query(`SELECT s.*, ${PROVENANCE} FROM klaro.lexical_senses s JOIN klaro.source_records p ON p.id = s.source_record_id WHERE s.entry_id = $1 AND s.release_id = $2 ORDER BY s.position LIMIT 6 OFFSET $3`, [id, version, offset])).rows;
    const senseIds = senses.slice(0, 5).map(row => row.id);
    const translations = (await this.pool.query(`SELECT t.*, ${PROVENANCE} FROM klaro.lexical_translations t JOIN klaro.source_records p ON p.id = t.source_record_id WHERE t.entry_id = $1 AND t.release_id = $2 AND t.language = $3 AND (t.sense_id = ANY($4::uuid[]) OR t.sense_id IS NULL) ORDER BY t.id`, [id, version, native, senseIds])).rows;
    const examples = (await this.pool.query(`SELECT x.*, ${PROVENANCE} FROM (SELECT x.*, row_number() OVER (PARTITION BY sense_id ORDER BY id) AS rank FROM klaro.lexical_examples x WHERE x.sense_id = ANY($1::uuid[]) AND x.release_id = $2) x JOIN klaro.source_records p ON p.id = x.source_record_id WHERE x.rank <= 2`, [senseIds, version])).rows;
    return { ...candidate(entry), features: entry['features'] as { tags: string[] }, provenance: provenance(entry), moreSenses: senses.length > 5,
      senses: senses.slice(0, 5).map(row => ({ id: row.id, definitions: row.glosses, definitionLanguage: row.definition_language, provenance: provenance(row), translations: translations.filter(t => t.sense_id === row.id).map(t => ({ text: t.text, language: t.language, provenance: provenance(t) })), examples: examples.filter(x => x.sense_id === row.id).map(x => ({ text: x.text, language: x.language, provenance: provenance(x) })) })),
      unlinkedTranslations: translations.filter(t => t.sense_id === null).map(t => ({ text: t.text, language: t.language, sourceSenseLabel: t.source_sense_label, provenance: provenance(t) })) };
  }
  async section(id: string, version: string, section: ReferenceSection): Promise<ReferenceSectionData | undefined> {
    const entry = await this.entry(id, version); if (!entry) return undefined;
    const base = { sourceVersion: version, section };
    if (!applicableSections(entry['language'] as ReferenceLanguage, String(entry['part_of_speech'])).includes(section)) return { ...base, state: 'not-applicable', items: [] };
    let items: ReferenceSectionData['items'];
    if (section === 'definitions' || section === 'usage') {
      const rows = (await this.pool.query(`SELECT s.*, ${PROVENANCE} FROM klaro.lexical_senses s JOIN klaro.source_records p ON p.id = s.source_record_id WHERE s.entry_id = $1 AND s.release_id = $2 ORDER BY s.position`, [id, version])).rows;
      items = rows.flatMap(row => (section === 'usage' && !row.tags.some((tag: string) => ['idiomatic', 'formal', 'informal', 'colloquial', 'archaic'].includes(tag)) ? [] : row.glosses.map((text: string) => ({ text, tags: row.tags, senseId: row.id, language: row.definition_language, provenance: provenance(row) }))));
    } else if (section === 'translations') {
      const rows = (await this.pool.query(`SELECT t.*, ${PROVENANCE} FROM klaro.lexical_translations t JOIN klaro.source_records p ON p.id = t.source_record_id WHERE t.entry_id = $1 AND t.release_id = $2 ORDER BY t.id`, [id, version])).rows;
      items = rows.map(row => ({ text: row.text, tags: [], senseId: row.sense_id, language: row.language, provenance: provenance(row) }));
    } else if (section === 'examples') {
      const rows = (await this.pool.query(`SELECT x.*, ${PROVENANCE} FROM klaro.lexical_examples x JOIN klaro.lexical_senses s ON s.id = x.sense_id JOIN klaro.source_records p ON p.id = x.source_record_id WHERE s.entry_id = $1 AND x.release_id = $2 ORDER BY x.id`, [id, version])).rows;
      items = rows.map(row => ({ text: row.text, tags: [], senseId: row.sense_id, language: row.language, provenance: provenance(row) }));
    } else {
      const rows = (await this.pool.query(`SELECT f.*, ${PROVENANCE} FROM klaro.lexical_inflections f JOIN klaro.source_records p ON p.id = f.source_record_id WHERE f.entry_id = $1 AND f.release_id = $2 ORDER BY f.id`, [id, version])).rows;
      items = rows.filter(row => matchesSection(section, row.tags)).map(row => ({ text: row.form, tags: row.tags, senseId: null, provenance: provenance(row) }));
      if (section === 'gender-article') { const tags = (entry['features'] as { tags: string[] }).tags.filter(tag => ['masculine', 'feminine', 'neuter'].includes(tag)); if (tags.length) items.unshift({ text: String(entry['lemma']), tags, senseId: null, provenance: provenance(entry) }); }
    }
    return { ...base, state: items.length ? 'available' : 'missing', items };
  }
  async availability(id: string, version: string): Promise<{ sections: { section: ReferenceSection; state: ReferenceSectionData['state'] }[] } | undefined> {
    const entry = await this.entry(id, version); if (!entry) return undefined;
    const sections = [];
    for (const section of applicableSections(entry['language'] as ReferenceLanguage, String(entry['part_of_speech']))) { const data = await this.section(id, version, section); if (!data) return undefined; sections.push({ section, state: data.state }); }
    return { sections };
  }
}
