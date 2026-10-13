import { z } from 'zod';
import { normalizeReferenceForm } from '@klaro/contracts';
import { contentHash, exampleAdmission, type SourceManifest } from './admission';

const text = z.string().min(1).max(1000000);
const tags = z.array(z.string().max(1000)).default([]);
const rawSchema = z.object({ word: text, lang_code: z.string(), pos: z.string().min(1).max(64), etymology_number: z.union([z.string(), z.number()]).optional(), head_nr: z.number().optional(), original_title: z.string().optional(),
  senses: z.array(z.object({ glosses: z.array(text).default([]), tags, senseid: z.array(z.string()).optional(), examples: z.array(z.record(z.string(), z.unknown())).default([]), translations: z.array(z.record(z.string(), z.unknown())).default([]) }).passthrough()).default([]),
  forms: z.array(z.object({ form: text, tags }).passthrough()).default([]),
  translations: z.array(z.record(z.string(), z.unknown())).default([]),
  tags,
}).passthrough();
export type Row = Record<string, unknown>;
export const TABLES = ['source_records', 'lexical_entries', 'lexical_senses', 'lexical_translations', 'lexical_examples', 'lexical_inflections'] as const;
export type Rows = Record<typeof TABLES[number], Row[]>;
export const emptyRows = (): Rows => ({ source_records: [], lexical_entries: [], lexical_senses: [], lexical_translations: [], lexical_examples: [], lexical_inflections: [] });
export function stableId(key: string): string {
  const hash = contentHash(key);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export const normalizeForm = normalizeReferenceForm;
export interface Coverage { lines: number; importedEntries: number; ignoredLanguages: number; duplicates: number; partsOfSpeech: Record<string, number>; translationLanguages: Record<string, number>; sections: Record<string, number>; exclusions: Record<string, number>; }
export const emptyCoverage = (): Coverage => ({ lines: 0, importedEntries: 0, ignoredLanguages: 0, duplicates: 0, partsOfSpeech: {}, translationLanguages: {}, sections: {}, exclusions: {} });
export const increment = (map: Record<string, number>, key: string): void => { map[key] = (map[key] ?? 0) + 1; };

export function mapEntry(input: unknown, manifest: SourceManifest, releaseId: string, coverage: Coverage): Rows {
  const raw = rawSchema.parse(input); const rows = emptyRows();
  if (!manifest.languages.includes(raw.lang_code as SourceManifest['languages'][number])) { coverage.ignoredLanguages++; return rows; }
  // Preserve source distinctions; equal lemmas alone never define identity.
  const nativeKey = `${raw.lang_code}:${raw.word}:${raw.pos}:${raw.etymology_number ?? ''}:${contentHash(raw)}`;
  const entryId = stableId(`${releaseId}:${nativeKey}`);
  const source = (path: string, value: unknown, evidence?: { license?: string; evidenceUrl?: string; attribution?: string }): string => {
    const id = stableId(`${releaseId}:${nativeKey}:${path}`);
    const license = evidence?.license ?? manifest.license;
    rows.source_records.push({ id, release_id: releaseId, native_key: nativeKey, fragment_path: path, source_url: `${manifest.articleBaseUrl}${encodeURIComponent(raw.original_title ?? raw.word)}`, source_revision: manifest.sourceRevision, license, license_url: license === 'CC0-1.0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' : manifest.licenseUrl, attribution: evidence?.attribution ?? manifest.attribution, evidence_url: evidence?.evidenceUrl ?? manifest.rightsEvidenceUrl, content_hash: contentHash(value) });
    return id;
  };
  const conflict = (value: Row): boolean => ['forbidden', 'revoked', 'unknown'].includes(String(value['rights_status'])) || Boolean(value['license'] && value['license'] !== manifest.license);
  const record = input as Row;
  if (conflict(record)) { increment(coverage.exclusions, 'entry-rights-conflict'); return rows; }
  const entrySource = source('entry', { word: raw.word, language: raw.lang_code, pos: raw.pos, etymology: raw.etymology_number ?? null, tags: raw.tags });
  rows.lexical_entries.push({ id: entryId, release_id: releaseId, native_key: nativeKey, language: raw.lang_code, lemma: raw.word, normalized_lemma: normalizeForm(raw.lang_code, raw.word), part_of_speech: raw.pos, homonym_key: `${raw.etymology_number ?? ''}:${raw.head_nr ?? ''}:${contentHash(raw.senses.map(sense => sense.glosses))}`, features: { tags: raw.tags }, source_record_id: entrySource });
  coverage.importedEntries++; increment(coverage.partsOfSpeech, `${raw.lang_code}:${raw.pos}`);
  const senses = raw.senses.map((sense, position) => {
    if (conflict(sense)) { increment(coverage.exclusions, 'sense-rights-conflict'); return null; }
    const id = stableId(`${entryId}:sense:${position}`);
    rows.lexical_senses.push({ id, release_id: releaseId, entry_id: entryId, position, glosses: sense.glosses, definition_language: manifest.definitionLanguage, tags: sense.tags, source_record_id: source(`senses/${position}`, { glosses: sense.glosses, tags: sense.tags, senseid: sense.senseid ?? [] }) });
    if (sense.glosses.length) increment(coverage.sections, `${raw.lang_code}:definitions`);
    for (const [index, example] of sense.examples.entries()) {
      const admission = exampleAdmission(example, manifest);
      if (!admission.admitted) { increment(coverage.exclusions, admission.reason); continue; }
      if (typeof example['text'] !== 'string' || !example['text'].trim()) { increment(coverage.exclusions, 'empty-example'); continue; }
      rows.lexical_examples.push({ id: stableId(`${id}:example:${index}`), release_id: releaseId, sense_id: id, text: example['text'], language: raw.lang_code, source_record_id: source(`senses/${position}/examples/${index}`, example, admission) });
      increment(coverage.sections, `${raw.lang_code}:examples`);
    }
    return { id, glosses: sense.glosses };
  });
  const translation = (value: Row, path: string, senseId: string | null): void => {
    const language = value['lang_code'] ?? value['code']; const word = value['word'];
    if (typeof language !== 'string' || !manifest.languages.includes(language as SourceManifest['languages'][number]) || typeof word !== 'string' || !word.trim()) return;
    if (conflict(value)) { increment(coverage.exclusions, 'translation-rights-conflict'); return; }
    rows.lexical_translations.push({ id: stableId(`${entryId}:${path}`), release_id: releaseId, entry_id: entryId, sense_id: senseId, language, text: word, source_sense_label: typeof value['sense'] === 'string' ? value['sense'] : null, source_record_id: source(path, value) });
    increment(coverage.translationLanguages, `${raw.lang_code}:${language}`);
  };
  raw.senses.forEach((sense, position) => { const mapped = senses[position]; if (mapped) sense.translations.forEach((value, index) => translation(value, `senses/${position}/translations/${index}`, mapped.id)); });
  raw.translations.forEach((value, index) => {
    const matches = typeof value['sense'] === 'string' ? senses.filter((sense): sense is NonNullable<typeof sense> => Boolean(sense && sense.glosses.includes(value['sense'] as string))) : [];
    // Preserve an unlinked label unless the source has one exact unambiguous gloss match.
    translation(value, `translations/${index}`, matches.length === 1 ? matches[0]!.id : null);
  });
  raw.forms.forEach((form, index) => {
    if (conflict(form)) { increment(coverage.exclusions, 'form-rights-conflict'); return; }
    rows.lexical_inflections.push({ id: stableId(`${entryId}:forms:${index}`), release_id: releaseId, entry_id: entryId, form: form.form, normalized_form: normalizeForm(raw.lang_code, form.form), tags: form.tags, source_record_id: source(`forms/${index}`, form) });
    increment(coverage.sections, `${raw.lang_code}:forms`);
  });
  const sounds = record['sounds'];
  if (Array.isArray(sounds) && sounds.length) coverage.exclusions['media'] = (coverage.exclusions['media'] ?? 0) + sounds.length;
  return rows;
}
