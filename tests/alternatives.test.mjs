import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OperationResultSchema } from '@klaro/contracts';
import { EditorSession } from '../packages/editor/src/session.ts';
import { EditorScheduler } from '../packages/editor/src/scheduler.ts';
const turn = () => new Promise(resolve => setImmediate(resolve));
const snapshot = (command, results) => ({ version: 'v1', operationId: 'operation', revisionId: command.revisionId, sequence: 3, status: 'completed', resultVersion: results.length, payloadStatus: 'available', results });

test('alternatives advance through one bounded batch without generating more variants', async () => {
  const session = new EditorSession(); session.setInput('Synthetic original');
  session.publish({ kind: 'correction', language: 'de', revisionId: session.revisionId, recommendationId: 'base', text: 'Synthetic primary', editGroups: [], warnings: ['no-changes'] }, 'parent');
  const calls = []; const port = { execute: async command => { calls.push(command); return snapshot(command, command.operationType === 'alternatives' ? [{ kind: 'alternatives', language: 'de', revisionId: command.revisionId, alternatives: [1, 2, 3].map(number => ({ recommendationId: `alternative-${number}`, text: `Synthetic variant ${number}` })), warnings: [] }] : [{ kind: 'translation', language: 'uk', revisionId: command.revisionId, recommendationId: command.recommendation.recommendationId, text: `Native ${command.recommendation.text}`, warnings: [] }]); } };
  const scheduler = new EditorScheduler(session, port, 'web'); await turn(); assert.equal(calls.length, 0);
  await scheduler.run(true, 'alternatives'); await turn(); assert.equal(session.mainText(), 'Synthetic variant 1'); assert.equal(session.alternatives.alternatives.length, 3);
  assert.equal(calls[0].parent.recommendationId, 'base'); await scheduler.run(true, 'alternatives'); await turn();
  assert.equal(calls.length, 3); assert.equal(calls[2].operationType, 'back-translation'); assert.equal(calls[2].recommendation.text, 'Synthetic variant 2'); assert.equal(session.mainText(), 'Synthetic variant 2');
  assert.equal(session.nativeResult.text, 'Native Synthetic variant 2'); assert.equal(session.input, 'Synthetic original'); assert.equal(session.selectAlternative('alternative-2'), false);
  const result = session.alternatives; assert.equal(OperationResultSchema.safeParse({ ...result, alternatives: [...result.alternatives, { recommendationId: 'four', text: 'Fourth' }] }).success, false);
  await scheduler.run(true, 'alternatives'); await turn(); assert.equal(session.mainText(), 'Synthetic variant 3'); assert.equal(session.hasNextAlternative(), false);
  const exhaustedCalls = calls.length; await scheduler.run(true, 'alternatives'); await turn(); assert.equal(calls.length, exhaustedCalls); assert.equal(calls.filter(call => call.operationType === 'alternatives').length, 1);
  session.setInput('New revision'); assert.equal(session.alternatives, undefined); await scheduler.run(true, 'alternatives'); await turn(); assert.equal(calls.filter(call => call.operationType === 'alternatives').length, 2); scheduler.dispose();
});

test('switching alternatives aborts the previous translation and rejects late replacement', async () => {
  const session = new EditorSession(); session.setInput('Original');
  session.publish({ kind: 'alternatives', language: 'de', revisionId: session.revisionId, alternatives: [{ recommendationId: 'one', text: 'One' }, { recommendationId: 'two', text: 'Two' }], warnings: [] }, 'parent');
  const calls = []; const scheduler = new EditorScheduler(session, { execute: (command, signal) => new Promise(resolve => calls.push({ command, signal, resolve })) }, 'panel');
  session.selectAlternative('one'); session.selectAlternative('two'); assert.equal(calls.length, 2); assert.equal(calls[0].signal.aborted, true);
  const complete = call => call.resolve(snapshot(call.command, [{ kind: 'translation', language: 'uk', revisionId: call.command.revisionId, recommendationId: call.command.recommendation.recommendationId, text: `Native ${call.command.recommendation.text}`, warnings: [] }]));
  complete(calls[1]); await turn(); complete(calls[0]); await turn(); assert.equal(session.mainText(), 'Two'); assert.equal(session.nativeResult.text, 'Native Two'); scheduler.dispose();
});

test('paraphrase is a separate explicit operation preserving the requested preference snapshot', async () => {
  const session = new EditorSession(); session.setInput('Original'); session.setPreferences({ ...session.preferences, style: 'formal', proficiency: 'B2' });
  const calls = []; const scheduler = new EditorScheduler(session, { execute: async command => { calls.push(command); return snapshot(command, []); } }, 'web');
  await turn(); assert.equal(calls.length, 0); await scheduler.run(true, 'paraphrase'); assert.equal(calls[0].operationType, 'paraphrase'); assert.equal(calls[0].preferences.style, 'formal'); assert.equal(calls[0].preferences.proficiency, 'B2'); assert.equal(session.input, 'Original'); scheduler.dispose();
});
