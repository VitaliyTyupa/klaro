import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorSession } from '../packages/editor/src/session.ts';
import { EditorScheduler } from '../packages/editor/src/scheduler.ts';
const turn = () => new Promise(resolve => setImmediate(resolve));
const snapshot = (command, results, error) => ({ version: 'v1', operationId: 'operation', revisionId: command.revisionId, sequence: 3, status: error ? 'partially-completed' : 'completed', resultVersion: results.length, payloadStatus: 'available', results, ...(error ? { error: { code: 'provider-error', retryable: true } } : {}) });

test('partial native failure preserves recommendation and explicit retry sends only one derived operation', async () => {
  const session = new EditorSession(); session.setInput('I is here.'); const calls = [];
  const port = { execute: async command => { calls.push(command); return command.operationType === 'correction' ? snapshot(command, [{ kind: 'correction', language: 'de', revisionId: command.revisionId, recommendationId: 'recommendation', text: 'I am here.', editGroups: [{ groupId: 'grammar', edits: [{ span: { start: 2, end: 4 }, original: 'is', replacement: 'am' }] }], warnings: [] }], true) : snapshot(command, [{ kind: 'translation', language: 'uk', revisionId: command.revisionId, recommendationId: command.recommendation.recommendationId, text: 'Synthetic native', warnings: [] }]); } };
  const scheduler = new EditorScheduler(session, port, 'web'); await scheduler.run();
  assert.equal(session.mainText(), 'I am here.'); assert.equal(session.resultStale, false); assert.equal(scheduler.nativeError, 'provider-error');
  await scheduler.runNative(); assert.deepEqual(calls.map(command => command.operationType), ['correction', 'back-translation']);
  assert.equal(calls[1].recommendation.text, 'I am here.'); assert.equal(session.nativeResult.text, 'Synthetic native'); assert.equal(scheduler.nativeError, undefined);
  await turn(); assert.equal(calls.length, 2);
  session.reviewEdit('grammar', false); await turn(); assert.equal(calls.length, 3); assert.equal(calls[2].operationType, 'back-translation'); assert.equal(calls[2].recommendation.text, 'I is here.'); assert.equal(session.input, 'I is here.'); scheduler.dispose();
});

test('changing a recommendation aborts its old native request and ignores late translation', async () => {
  const session = new EditorSession(); session.setInput('I is here.');
  session.publish({ kind: 'correction', language: 'de', revisionId: session.revisionId, recommendationId: 'base', text: 'I am here.', editGroups: [{ groupId: 'grammar', edits: [{ span: { start: 2, end: 4 }, original: 'is', replacement: 'am' }] }], warnings: [] }, 'parent');
  const calls = []; const port = { execute: (command, signal) => new Promise(resolve => calls.push({ command, signal, resolve })) };
  const scheduler = new EditorScheduler(session, port, 'panel');
  const first = scheduler.runNative(); session.reviewEdit('grammar', false); assert.equal(calls[0].signal.aborted, true); assert.equal(calls.length, 2);
  const complete = (call, text) => call.resolve(snapshot(call.command, [{ kind: 'translation', language: 'uk', revisionId: call.command.revisionId, recommendationId: call.command.recommendation.recommendationId, text, warnings: [] }]));
  complete(calls[1], 'Current native'); await turn(); complete(calls[0], 'Obsolete native'); await first;
  assert.equal(session.nativeResult.text, 'Current native'); assert.equal(session.nativeStale, false); assert.equal(session.mainText(), 'I is here.'); scheduler.dispose();
});
