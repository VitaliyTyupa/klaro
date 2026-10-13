import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorSession } from '../packages/editor/src/session.ts';
import { EditorScheduler } from '../packages/editor/src/scheduler.ts';
import { taskInput } from '../dist/api/ai/task.js';
const turn = () => new Promise(resolve => setImmediate(resolve));
const snapshot = (command, results) => ({ version: 'v1', operationId: 'operation', revisionId: command.revisionId, sequence: 3, status: 'completed', resultVersion: results.length, payloadStatus: 'available', results });
function fixture() {
  const session = new EditorSession(); session.setInput('I is here.');
  session.publish({ kind: 'correction', language: 'de', revisionId: session.revisionId, recommendationId: 'base', text: 'I am here.', editGroups: [{ groupId: 'grammar', edits: [{ span: { start: 2, end: 4 }, original: 'is', replacement: 'am' }] }], warnings: [] }, 'parent');
  session.publish({ kind: 'translation', language: 'uk', revisionId: session.revisionId, recommendationId: 'base', text: 'Synthetic native', warnings: [] }); return session;
}

test('explicit explanation compares the current original/recommendation in the native language', async () => {
  const session = fixture(); const calls = [];
  const scheduler = new EditorScheduler(session, { execute: async command => { calls.push(command); return snapshot(command, [{ kind: command.operationType === 'explanation' ? 'explanation' : 'translation', language: 'uk', revisionId: command.revisionId, recommendationId: command.recommendation.recommendationId, text: 'Synthetic explanation', warnings: [] }]); } }, 'web');
  await turn(); assert.equal(calls.length, 0); await scheduler.explain(); assert.equal(calls.length, 1);
  assert.equal(calls[0].operationType, 'explanation'); assert.equal(calls[0].targetLanguage, 'uk'); assert.equal(calls[0].input, 'I is here.'); assert.equal(calls[0].recommendation.text, 'I am here.');
  const data = taskInput({ command: calls[0], stageId: 'explanation', resultKind: 'explanation', promptVersion: 'language-v4', sourceLanguage: 'de', targetLanguage: 'uk', text: calls[0].input });
  assert.equal(data.original, 'I is here.'); assert.equal(data.recommendation.text, 'I am here.');
  assert.equal(session.mainText(), 'I am here.'); assert.equal(session.nativeResult.text, 'Synthetic native'); assert.equal(session.explanation.text, 'Synthetic explanation');
  session.reviewEdit('grammar', false); await turn(); assert.equal(session.explanationStale, true); assert.equal(calls.filter(command => command.operationType === 'explanation').length, 1);
  session.clear(); assert.equal(session.explanation, undefined); scheduler.dispose();
});

test('late explanation for obsolete edits cannot become the active explanation', async () => {
  const session = fixture(); const calls = [];
  const scheduler = new EditorScheduler(session, { execute: (command, signal) => new Promise(resolve => calls.push({ command, signal, resolve })) }, 'panel');
  const pending = scheduler.explain(); session.reviewEdit('grammar', false); assert.equal(calls[0].signal.aborted, true);
  calls[0].resolve(snapshot(calls[0].command, [{ kind: 'explanation', language: 'uk', revisionId: calls[0].command.revisionId, recommendationId: 'base', text: 'Obsolete', warnings: [] }])); await pending;
  assert.equal(session.explanation, undefined); assert.equal(session.mainText(), 'I is here.');
  scheduler.dispose(); calls[1].resolve(snapshot(calls[1].command, [])); await turn();
});
