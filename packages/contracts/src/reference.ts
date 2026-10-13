import { z } from 'zod';
import { LanguageSchema } from './v1.js';
export const ReferenceLookupSchema = z.strictObject({ language: LanguageSchema, query: z.string().trim().min(1).max(200), offset: z.coerce.number().int().min(0).max(10000).default(0) });
export const ReferenceSectionSchema = z.enum(['definitions', 'translations', 'examples', 'forms', 'infinitive-participle', 'indicative', 'subjunctive', 'imperative', 'gender-article', 'plural', 'declension', 'comparison', 'usage']);
export type ReferenceSection = z.infer<typeof ReferenceSectionSchema>;
export type ReferenceLanguage = z.infer<typeof LanguageSchema>;
export interface ReferenceProvenance { id: string; url: string; revision: string; license: string; licenseUrl: string; attribution: string; evidenceUrl: string; }
export interface ReferenceCandidate { id: string; sourceVersion: string; language: ReferenceLanguage; lemma: string; partOfSpeech: string; homonymKey: string; preview?: string; }
export interface ReferenceLookup { version: 'v1'; candidates: ReferenceCandidate[]; nextOffset: number | null; }
export interface ReferenceSense { id: string; definitions: string[]; definitionLanguage: ReferenceLanguage; provenance: ReferenceProvenance; translations: { text: string; language: ReferenceLanguage; provenance: ReferenceProvenance }[]; examples: { text: string; language: ReferenceLanguage; provenance: ReferenceProvenance }[]; }
export interface ReferenceCard extends ReferenceCandidate { features: { tags: string[] }; provenance: ReferenceProvenance; senses: ReferenceSense[]; moreSenses: boolean; unlinkedTranslations: { text: string; language: ReferenceLanguage; sourceSenseLabel: string | null; provenance: ReferenceProvenance }[]; }
export interface ReferenceSectionData { state: 'available' | 'missing' | 'not-applicable'; sourceVersion: string; section: ReferenceSection; items: { text: string; tags: string[]; senseId: string | null; language?: ReferenceLanguage; provenance: ReferenceProvenance }[]; }
export function normalizeReferenceForm(language: string, value: string): string { const normalized = value.normalize('NFC').trim().toLocaleLowerCase(language); return language === 'uk' ? normalized.replace(/[’ʼ]/g, "'") : normalized; }
export interface AiSupplement { id: string; entryId: string; sourceVersion: string; senseId?: string; section: ReferenceSection; targetLanguage: ReferenceLanguage; originKind: 'machine-translation' | 'generated-unverified'; text: string; expiresAt: string; }
export const ReferenceReportSchema = z.strictObject({ targetId: z.uuid(), targetKind: z.enum(['reference', 'supplement']), reason: z.enum(['wrong-sense', 'wrong-form', 'wrong-translation', 'rights', 'other']) });
