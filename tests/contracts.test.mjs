import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PREFERENCES, OperationCommandSchema, OperationEventSchema, OperationResultSchema, PreferencesSchema, StructuredErrorSchema, codePointLength } from '../packages/contracts/src/v1.ts';

const command = { version: 'v1', clientRequestId: 'request-1', revisionId: 'revision-1', operationType: 'correction', surface: 'panel', input: 'Guten Tag!', selection: { scope: 'document' }, preferences: DEFAULT_PREFERENCES, sourceLanguage: 'de', targetLanguage: 'de' };
const valid = value => OperationCommandSchema.safeParse(value).success;

test('preferences enforce language roles and stable technical values', () => {
  assert.equal(PreferencesSchema.safeParse(DEFAULT_PREFERENCES).success, true);
  for (const preferences of [
    { ...DEFAULT_PREFERENCES, nativeLanguage: 'fr' },
    { ...DEFAULT_PREFERENCES, writingLanguages: ['uk'] },
    { ...DEFAULT_PREFERENCES, activeWritingLanguage: 'en' },
    { ...DEFAULT_PREFERENCES, writingLanguages: ['de', 'de'] },
    { ...DEFAULT_PREFERENCES, style: 'Офіційний' },
    { ...DEFAULT_PREFERENCES, userId: 'forged-user' },
  ]) assert.equal(PreferencesSchema.safeParse(preferences).success, false);
});

test('panel and web limits count Unicode code points without truncating', () => {
  for (const [surface, limit] of [['panel', 5000], ['web', 20000]]) {
    assert.equal(valid({ ...command, surface, input: '😀'.repeat(limit) }), true);
    assert.equal(valid({ ...command, surface, input: '😀'.repeat(limit + 1) }), false);
  }
  assert.equal(codePointLength('e\u0301😀'), 3);
});

test('selection bounds reject split surrogate pairs, empty and out-of-range spans', () => {
  const selected = { ...command, input: 'a😀b', selection: { scope: 'selection', start: 1, end: 3 } };
  assert.equal(valid(selected), true);
  for (const [start, end] of [[1, 2], [2, 3], [1, 1], [3, 1], [-1, 1], [0, 5], [0.5, 1]]) assert.equal(valid({ ...selected, selection: { scope: 'selection', start, end } }), false);
  assert.equal(valid({ ...selected, protectedSpans: [{ start: 1, end: 2 }] }), false);
});

test('commands reject unknown versions, enums, blank text and injected server fields', () => {
  assert.equal(valid(command), true);
  for (const patch of [{ version: 'v2' }, { operationType: 'harvest' }, { input: ' \n ' }, { userId: 'other-account' }, { model: 'vendor-model' }, { selection: { scope: 'document', text: 'hidden' } }]) assert.equal(valid({ ...command, ...patch }), false);
});

test('translation accepts all twelve native-anchored directions and rejects foreign pairs', () => {
  const languages = ['uk', 'de', 'en', 'vi'];
  for (const nativeLanguage of languages) for (const activeWritingLanguage of languages.filter(language => language !== nativeLanguage)) {
    const preferences = { ...DEFAULT_PREFERENCES, nativeLanguage, writingLanguages: [activeWritingLanguage], activeWritingLanguage };
    for (const [sourceLanguage, targetLanguage] of [[nativeLanguage, activeWritingLanguage], [activeWritingLanguage, nativeLanguage]]) assert.equal(valid({ ...command, preferences, operationType: 'translation', sourceLanguage, targetLanguage }), true);
  }
  assert.equal(valid({ ...command, operationType: 'translation', sourceLanguage: 'de', targetLanguage: 'en' }), false);
});

test('results and errors reject markup execution fields and excessive alternatives', () => {
  const result = { kind: 'translation', revisionId: 'revision-1', text: '<script>untrusted data</script>', warnings: [] };
  assert.equal(OperationResultSchema.safeParse(result).success, true);
  assert.equal(OperationResultSchema.safeParse({ ...result, html: true }).success, false);
  assert.equal(OperationResultSchema.safeParse({ kind: 'alternatives', revisionId: 'revision-1', alternatives: Array.from({ length: 4 }, (_, index) => ({ recommendationId: `r-${index}`, text: 'Text' })), warnings: [] }).success, false);
  assert.equal(StructuredErrorSchema.safeParse({ code: 'provider-error', retryable: true }).success, true);
  assert.equal(StructuredErrorSchema.safeParse({ code: 'provider-error', retryable: true, rawProviderResponse: 'private' }).success, false);
});

test('events require bounded sequence and complete correlation', () => {
  const event = { version: 'v1', operationId: 'operation-1', revisionId: 'revision-1', sequence: 1, status: 'running', event: 'stage.started', stageId: 'correction', resultVersion: 0 };
  assert.equal(OperationEventSchema.safeParse(event).success, true);
  assert.equal(OperationEventSchema.safeParse({ ...event, sequence: -1 }).success, false);
  assert.equal(OperationEventSchema.safeParse({ ...event, stageId: undefined }).success, false);
});
