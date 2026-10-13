import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PREFERENCES, OperationCommandSchema } from '@klaro/contracts';
import { DEFAULT_POLICY } from '../dist/api/ai/policies.js';
import { OpenAiResponsesAdapter } from '../dist/api/ai/openai-responses.js';
import { validateResult } from '../dist/api/ai/result-validation.js';
import { workflowFor } from '../apps/api/src/ai/workflows.ts';

test('all twelve native-anchored directions have one stage and reject cross-language requests', () => {
  const languages = ['uk', 'de', 'en', 'vi']; const directions = new Set();
  for (const nativeLanguage of languages) for (const activeWritingLanguage of languages.filter(language => language !== nativeLanguage)) {
    const preferences = { ...DEFAULT_PREFERENCES, nativeLanguage, activeWritingLanguage, writingLanguages: [activeWritingLanguage] };
    for (const [sourceLanguage, targetLanguage] of [[nativeLanguage, activeWritingLanguage], [activeWritingLanguage, nativeLanguage]]) {
      const command = OperationCommandSchema.parse({ version: 'v1', clientRequestId: crypto.randomUUID(), revisionId: crypto.randomUUID(), operationType: 'translation', surface: 'panel', input: 'Synthetic 3', selection: { scope: 'document' }, preferences, sourceLanguage, targetLanguage, protectedSpans: [] });
      assert.equal(workflowFor(command, DEFAULT_POLICY).stages.length, 1); directions.add(`${sourceLanguage}-${targetLanguage}`);
      const unrelated = languages.find(language => language !== nativeLanguage && language !== activeWritingLanguage);
      assert.equal(OperationCommandSchema.safeParse({ ...command, sourceLanguage: activeWritingLanguage, targetLanguage: unrelated }).success, false);
    }
  }
  assert.equal(directions.size, 12);
});

test('translation v5 protects digits, literal terms, paragraphs and separate uncertainty warnings', () => {
  const text = 'ABC-123: 3 packages.\n\nNo promise.';
  const command = { operationType: 'translation', revisionId: 'revision', input: text, selection: { scope: 'document' }, protectedSpans: [{ start: 0, end: 7 }] };
  const task = { command, promptVersion: 'language-v5', resultKind: 'translation', targetLanguage: 'de' };
  const result = { kind: 'translation', revisionId: 'revision', language: 'de', text: 'ABC-123: 3 Pakete.\n\nKein Versprechen.', warnings: ['ambiguous-input', 'language-mismatch'] };
  assert.ok(validateResult(task, result));
  for (const invalid of [result.text.replace('3 Pakete', '4 Pakete'), result.text.replace('ABC', 'XYZ'), result.text.replace('\n\n', ' '), result.text + ' 5']) assert.equal(validateResult(task, { ...result, text: invalid }), undefined);
  assert.equal(validateResult(task, { ...result, language: 'en' }), undefined);
});

test('translation prompt sends selected input and bounded explicit context without a feedback instruction', async () => {
  let body;
  const adapter = new OpenAiResponsesAdapter('synthetic-only', async (_url, init) => { body = JSON.parse(init.body); return Response.json({ status: 'completed', output: [] }); });
  const command = { operationType: 'translation', revisionId: 'revision', input: 'Private prefix\nSelected 3\nPrivate suffix', selection: { scope: 'selection', start: 15, end: 25 }, context: 'Explicit context', protectedSpans: [], preferences: { ...DEFAULT_PREFERENCES, style: 'formal', proficiency: 'B2' } };
  await adapter.execute({ command, stageId: 'translation', resultKind: 'translation', text: 'Selected 3', sourceLanguage: 'uk', targetLanguage: 'de', promptVersion: DEFAULT_POLICY.promptVersion, policy: { ...DEFAULT_POLICY.model, provider: 'openai' } }, new AbortController().signal);
  for (const term of ['communicative intent', 'negation', 'paragraph', 'terminology', 'ambiguous-input', 'language-mismatch', 'never include surrounding context', 'do not translate it back']) assert.ok(body.instructions.includes(term));
  const data = JSON.parse(body.input[0].content[0].text); assert.equal(data.text, 'Selected 3'); assert.equal(data.original, 'Selected 3'); assert.equal(data.context, 'Explicit context'); assert.equal(data.style, 'formal'); assert.equal(data.proficiency, 'B2');
  assert.equal(JSON.stringify(body).includes('Private prefix'), false);
});
