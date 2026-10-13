import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorSession } from '../packages/editor/src/session.ts';
import { EditorScheduler } from '../packages/editor/src/scheduler.ts';
import { DEFAULT_PREFERENCES } from '@klaro/contracts';
import { validateResult } from '../dist/api/ai/result-validation.js';
import { OpenAiResponsesAdapter } from '../dist/api/ai/openai-responses.js';
import { DEFAULT_POLICY } from '../dist/api/ai/policies.js';

test('protected selection is session-scoped, revision-bound and included in explicit correction', async () => {
  const session = new EditorSession(); session.setInput('😀 ABC-123 remains.'); session.setSelection(3, 10);
  const revision = session.revisionId; assert.equal(session.protectSelection(), true); assert.notEqual(session.revisionId, revision); assert.equal(session.protectSelection(), false);
  let received;
  const scheduler = new EditorScheduler(session, { execute: async command => { received = command; return { version: 'v1', operationId: 'synthetic', revisionId: command.revisionId, sequence: 1, status: 'completed', resultVersion: 0, payloadStatus: 'available', results: [] }; } }, 'web');
  await scheduler.run(); assert.deepEqual(received.protectedSpans, [{ start: 3, end: 10 }]);
  assert.equal(received.sourceLanguage, 'de'); assert.equal(received.targetLanguage, 'de');
  session.setInput('New draft'); assert.deepEqual(session.protectedSpans, []); scheduler.dispose(); session.clear();
});

test('an unchanged duplicate term elsewhere cannot hide editing the protected occurrence', () => {
  const command = { revisionId: 'revision', input: 'Mia and Mia receive 3 packages.', selection: { scope: 'document' }, protectedSpans: [{ start: 0, end: 3 }], preferences: DEFAULT_PREFERENCES };
  const task = { command, promptVersion: 'language-v3', resultKind: 'correction', sourceLanguage: 'de', targetLanguage: 'de' };
  const base = { kind: 'correction', language: 'de', revisionId: 'revision', recommendationId: 'recommendation', text: command.input, editGroups: [], warnings: ['no-changes'] };
  assert.ok(validateResult(task, base));
  const edit = { span: { start: 0, end: 3 }, original: 'Mia', replacement: 'Ava' };
  assert.equal(validateResult(task, { ...base, text: 'Ava and Mia receive 3 packages.', editGroups: [{ groupId: 'name', edits: [edit] }], warnings: [] }), undefined);
  const number = { span: { start: 20, end: 21 }, original: '3', replacement: '4' };
  assert.equal(validateResult(task, { ...base, text: 'Mia and Mia receive 4 packages.', editGroups: [{ groupId: 'number', edits: [number] }], warnings: [] }), undefined);
  assert.equal(validateResult(task, { ...base, warnings: [] }), undefined);
});

test('versioned correction prompt covers minimal grammar, ambiguity, style and exact protected offsets', async () => {
  const command = { revisionId: 'revision', operationType: 'correction', input: 'prefix Mia suffix', selection: { scope: 'selection', start: 7, end: 10 }, protectedSpans: [{ start: 7, end: 10 }], preferences: { ...DEFAULT_PREFERENCES, style: 'formal', proficiency: 'B2' } };
  let recorded;
  const adapter = new OpenAiResponsesAdapter('synthetic-only', async (_url, init) => { recorded = JSON.parse(init.body); return Response.json({ status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1 } }); });
  await adapter.execute({ command, promptVersion: DEFAULT_POLICY.promptVersion, stageId: 'correction', resultKind: 'correction', sourceLanguage: 'de', targetLanguage: 'de', text: 'Mia', policy: { ...DEFAULT_POLICY.model, provider: 'openai', model: 'synthetic' } }, new AbortController().signal);
  assert.equal(DEFAULT_POLICY.promptVersion, 'language-v5');
  for (const term of ['spelling', 'grammar', 'punctuation', 'word-order', 'natural-wording', 'minimal', 'ambiguous', 'commitment', 'protected span', 'no-changes', 'formal use Sie']) assert.ok(recorded.instructions.includes(term));
  const data = JSON.parse(recorded.input[0].content[0].text); assert.deepEqual(data.protectedSpans, [{ start: 0, end: 3 }]); assert.deepEqual(data.protectedTerms, ['Mia']); assert.equal(data.style, 'formal'); assert.equal(data.proficiency, 'B2');
  assert.equal(JSON.stringify(recorded).includes('prefix'), false); assert.equal(JSON.stringify(recorded).includes('suffix'), false);
});
