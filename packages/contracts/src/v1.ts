import { z } from 'zod';

export const CONTRACT_VERSION = 'v1' as const;
export const INPUT_LIMITS = { panel: 5000, web: 20000 } as const;
export const LanguageSchema = z.enum(['uk', 'de', 'en', 'vi']);
export const StyleSchema = z.enum(['neutral', 'formal']);
export const ProficiencySchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).nullable();
export const IdentifierSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);

export function codePointLength(text: string): number {
  return Array.from(text).length;
}

export function isUtf16Boundary(text: string, offset: number): boolean {
  if (offset < 0 || offset > text.length) return false;
  if (offset === 0 || offset === text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}

function boundedText(maximum: number) {
  return z.string().max(maximum * 2).refine(text => codePointLength(text) <= maximum, 'Input limit exceeded');
}

export const PreferencesSchema = z.strictObject({
  version: z.literal(CONTRACT_VERSION),
  nativeLanguage: LanguageSchema,
  writingLanguages: z.array(LanguageSchema).min(1).max(3),
  activeWritingLanguage: LanguageSchema,
  style: StyleSchema,
  proficiency: ProficiencySchema,
}).superRefine((value, context) => {
  if (value.writingLanguages.includes(value.nativeLanguage)) context.addIssue({ code: 'custom', path: ['writingLanguages'], message: 'Native language cannot be a writing language' });
  if (new Set(value.writingLanguages).size !== value.writingLanguages.length) context.addIssue({ code: 'custom', path: ['writingLanguages'], message: 'Writing languages must be unique' });
  if (!value.writingLanguages.includes(value.activeWritingLanguage)) context.addIssue({ code: 'custom', path: ['activeWritingLanguage'], message: 'Active writing language must be enabled' });
});
export type Preferences = z.infer<typeof PreferencesSchema>;
export const DEFAULT_PREFERENCES: Preferences = {
  version: 'v1', nativeLanguage: 'uk', writingLanguages: ['de'], activeWritingLanguage: 'de', style: 'neutral', proficiency: null,
};

export const SpanSchema = z.strictObject({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).refine(span => span.end > span.start, 'Span must not be empty');
export const SelectionSchema = z.discriminatedUnion('scope', [
  z.strictObject({ scope: z.literal('document') }),
  z.strictObject({ scope: z.literal('selection'), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }),
]);
export const OperationTypeSchema = z.enum(['correction', 'paraphrase', 'alternatives', 'explanation', 'back-translation', 'translation', 'lexical-supplement', 'source-translation']);
export const OperationStatusSchema = z.enum(['accepted', 'running', 'partially-completed', 'completed', 'failed', 'cancelled', 'indeterminate']);
export const ErrorCodeSchema = z.enum(['invalid-request', 'unauthenticated', 'forbidden', 'conflict', 'payload-expired', 'quota-exceeded', 'input-too-large', 'provider-refusal', 'provider-incomplete', 'provider-error', 'invalid-result', 'cancelled', 'indeterminate', 'unavailable']);
export const StructuredErrorSchema = z.strictObject({ code: ErrorCodeSchema, retryable: z.boolean(), field: z.string().max(128).optional() });

const parent = z.strictObject({ operationId: IdentifierSchema, recommendationId: IdentifierSchema.optional() });
const recommendation = z.strictObject({ recommendationId: IdentifierSchema, text: boundedText(40000) });
const lexical = z.strictObject({ entryId: IdentifierSchema.optional(), senseId: IdentifierSchema.optional(), section: IdentifierSchema, sourceVersion: IdentifierSchema.optional() });

export const OperationCommandSchema = z.strictObject({
  version: z.literal(CONTRACT_VERSION),
  clientRequestId: IdentifierSchema,
  revisionId: IdentifierSchema,
  operationType: OperationTypeSchema,
  surface: z.enum(['panel', 'web']),
  input: boundedText(INPUT_LIMITS.web).refine(text => text.trim().length > 0, 'Input must not be blank'),
  selection: SelectionSchema,
  preferences: PreferencesSchema,
  sourceLanguage: LanguageSchema,
  targetLanguage: LanguageSchema,
  context: boundedText(4000).optional(),
  protectedSpans: z.array(SpanSchema).max(100).default([]),
  parent: parent.optional(),
  recommendation: recommendation.optional(),
  lexical: lexical.optional(),
}).superRefine((value, context) => {
  const issue = (field: string, message: string) => context.addIssue({ code: 'custom', path: [field], message });
  if (codePointLength(value.input) > INPUT_LIMITS[value.surface]) issue('input', 'Input limit exceeded');
  if (value.selection.scope === 'selection') {
    const { start, end } = value.selection;
    if (end <= start || !isUtf16Boundary(value.input, start) || !isUtf16Boundary(value.input, end)) issue('selection', 'Invalid UTF-16 selection bounds');
  }
  for (const span of value.protectedSpans) {
    if (!isUtf16Boundary(value.input, span.start) || !isUtf16Boundary(value.input, span.end)) issue('protectedSpans', 'Invalid UTF-16 protected span');
  }
  const { nativeLanguage, activeWritingLanguage } = value.preferences;
  if (value.operationType === 'translation') {
    const forward = value.sourceLanguage === nativeLanguage && value.targetLanguage === activeWritingLanguage;
    const reverse = value.sourceLanguage === activeWritingLanguage && value.targetLanguage === nativeLanguage;
    if (!forward && !reverse) issue('targetLanguage', 'Translation must be native anchored');
  }
  if (['correction', 'paraphrase', 'alternatives'].includes(value.operationType) && (value.sourceLanguage !== activeWritingLanguage || value.targetLanguage !== activeWritingLanguage)) issue('targetLanguage', 'Correction must use the active writing language');
  if (['back-translation', 'explanation'].includes(value.operationType)) {
    if (!value.parent || !value.recommendation) issue('recommendation', 'A current recommendation snapshot and parent are required');
    if (value.sourceLanguage !== activeWritingLanguage || value.targetLanguage !== nativeLanguage) issue('targetLanguage', 'Derived result must use the native language');
  }
  if (['lexical-supplement', 'source-translation'].includes(value.operationType) && !value.lexical) issue('lexical', 'Lexical section is required');
  if (value.operationType === 'source-translation' && (!value.lexical?.entryId || !value.lexical.sourceVersion)) issue('lexical', 'Sourced translation requires a canonical source version');
});
export type OperationCommand = z.infer<typeof OperationCommandSchema>;

export const EditGroupSchema = z.strictObject({
  groupId: IdentifierSchema,
  edits: z.array(z.strictObject({ span: SpanSchema, original: boundedText(20000), replacement: boundedText(40000) })).min(1).max(100),
});
const warnings = z.array(z.enum(['ambiguous-input', 'language-mismatch', 'protected-term-conflict', 'no-changes', 'unverified-grammar'])).max(20);
export const OperationResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('correction'), language: LanguageSchema.optional(), revisionId: IdentifierSchema, recommendationId: IdentifierSchema, text: boundedText(40000), editGroups: z.array(EditGroupSchema).max(100), warnings }),
  z.strictObject({ kind: z.literal('alternatives'), language: LanguageSchema.optional(), revisionId: IdentifierSchema, alternatives: z.array(recommendation).min(1).max(3), warnings }),
  z.strictObject({ kind: z.literal('translation'), language: LanguageSchema.optional(), revisionId: IdentifierSchema, recommendationId: IdentifierSchema.optional(), text: boundedText(40000), warnings }),
  z.strictObject({ kind: z.literal('explanation'), language: LanguageSchema.optional(), revisionId: IdentifierSchema, recommendationId: IdentifierSchema, text: boundedText(40000), warnings }),
  z.strictObject({ kind: z.literal('lexical'), language: LanguageSchema.optional(), revisionId: IdentifierSchema, entryId: IdentifierSchema.optional(), senseId: IdentifierSchema.optional(), section: IdentifierSchema, text: boundedText(40000), originKind: z.enum(['machine-translation', 'generated-unverified']), sourceVersion: IdentifierSchema.optional(), warnings }),
]);
export type OperationResult = z.infer<typeof OperationResultSchema>;

const correlation = { version: z.literal(CONTRACT_VERSION), operationId: IdentifierSchema, revisionId: IdentifierSchema, sequence: z.number().int().nonnegative(), status: OperationStatusSchema };
export const AcceptedSchema = z.strictObject({ ...correlation, status: z.literal('accepted'), resourceUrl: z.string().regex(/^\/v1\/operations\/[a-zA-Z0-9_-]+$/) });
export const OperationEventSchema = z.strictObject({
  ...correlation,
  event: z.enum(['operation.accepted', 'stage.started', 'stage.completed', 'operation.completed', 'operation.failed', 'operation.cancelled']),
  stageId: IdentifierSchema.nullable(),
  resultVersion: z.number().int().nonnegative(),
  result: OperationResultSchema.optional(),
  error: StructuredErrorSchema.optional(),
});
export const OperationSnapshotSchema = z.strictObject({
  ...correlation,
  resultVersion: z.number().int().nonnegative(),
  payloadStatus: z.enum(['available', 'expired']),
  results: z.array(OperationResultSchema).max(5),
  error: StructuredErrorSchema.optional(),
});

export type StructuredError = z.infer<typeof StructuredErrorSchema>;
export type OperationStatus = z.infer<typeof OperationStatusSchema>;
export type Accepted = z.infer<typeof AcceptedSchema>;
export type OperationEvent = z.infer<typeof OperationEventSchema>;
export type OperationSnapshot = z.infer<typeof OperationSnapshotSchema>;

const usageCounts = z.strictObject({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), costMicrousd: z.number().int().nonnegative() });
export const UsageSummarySchema = z.strictObject({ version: z.literal('v1'), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), operations: z.number().int().nonnegative(), providerAttempts: z.number().int().nonnegative(), actual: usageCounts, estimated: usageCounts, heldTokens: z.number().int().nonnegative(), heldCostMicrousd: z.number().int().nonnegative() });
export type UsageSummary = z.infer<typeof UsageSummarySchema>;
