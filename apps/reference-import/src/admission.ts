import { createHash } from 'node:crypto';
import { z } from 'zod';

export const LanguageSchema = z.enum(['uk', 'de', 'en', 'vi']);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const SourceManifestSchema = z.strictObject({
  version: z.literal('v1'), sourceId: z.enum(['kaikki-enwiktionary', 'synthetic-fixture']),
  downloadUrl: z.url(), metadataUrl: z.url(), sourceRevision: z.string().min(1).max(200),
  extractorRevisions: z.array(z.string().min(1).max(100)).min(1).max(5),
  languages: z.array(LanguageSchema).min(1).max(4), definitionLanguage: LanguageSchema,
  license: z.enum(['CC-BY-SA-4.0', 'CC0-1.0', 'unknown']), licenseUrl: z.url(),
  rightsStatus: z.enum(['admitted', 'unknown', 'revoked']), rightsEvidenceUrl: z.url(), reviewedAt: z.iso.date(),
  attribution: z.string().min(1).max(2000), articleBaseUrl: z.url(),
  exclusionPolicy: z.literal('wiktionary-text-v1'), sha256: digest.nullable(),
  exampleEvidence: z.array(z.strictObject({ contentHash: digest, license: z.enum(['CC-BY-SA-4.0', 'CC0-1.0']), evidenceUrl: z.url(), attribution: z.string().min(1).max(2000) })).max(10000),
});
export type SourceManifest = z.infer<typeof SourceManifestSchema>;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
export const contentHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export function admitSource(input: unknown, allowSynthetic = false): SourceManifest {
  const manifest = SourceManifestSchema.parse(input);
  if (new Set(manifest.languages).size !== manifest.languages.length || manifest.rightsStatus !== 'admitted' || manifest.license === 'unknown') throw new Error('Source rights are not admitted');
  if (manifest.sourceId === 'synthetic-fixture') { if (!allowSynthetic || manifest.license !== 'CC0-1.0') throw new Error('Synthetic source is test-only'); }
  else if (manifest.downloadUrl !== 'https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz' || manifest.metadataUrl !== 'https://kaikki.org/dictionary/rawdata.html' || manifest.articleBaseUrl !== 'https://en.wiktionary.org/wiki/' || manifest.license !== 'CC-BY-SA-4.0' || manifest.licenseUrl !== 'https://creativecommons.org/licenses/by-sa/4.0/' || manifest.rightsEvidenceUrl !== 'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use#7._Licensing_of_Content') throw new Error('Source is not allowlisted');
  if (new Set(manifest.exampleEvidence.map(item => item.contentHash)).size !== manifest.exampleEvidence.length) throw new Error('Duplicate example evidence');
  return manifest;
}

export function exampleAdmission(example: Record<string, unknown>, manifest: SourceManifest): { admitted: boolean; reason: string; license?: string; evidenceUrl?: string; attribution?: string } {
  const evidence = manifest.exampleEvidence.find(item => item.contentHash === contentHash(example));
  // ExampleData has no general license field; refs and type alone cannot grant permission.
  if (example['rights_status'] === 'unknown' || example['rights_status'] === 'revoked' || example['rights_status'] === 'forbidden' || example['license'] === 'unknown') return { admitted: false, reason: 'conflicting-rights' };
  if (evidence && example['license'] && example['license'] !== evidence.license) return { admitted: false, reason: 'conflicting-rights' };
  if (!evidence) return { admitted: false, reason: example['ref'] || example['type'] === 'quotation' ? 'quotation-unverified' : 'example-rights-unknown' };
  return { admitted: true, reason: 'explicit-evidence', license: evidence.license, evidenceUrl: evidence.evidenceUrl, attribution: evidence.attribution };
}
