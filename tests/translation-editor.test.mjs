import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorSession } from '../packages/editor/src/session.ts';
import { EditorScheduler } from '../packages/editor/src/scheduler.ts';

test('direction swap preserves profile and input, invalidates late results and never sends native rendering', async () => {
  for (const surface of ['web', 'panel']) {
    const session = new EditorSession(); session.setMode('translation'); session.setInput('Prefix 😀 Selected suffix'); session.setSelection(7, 18);
    const preferences = structuredClone(session.preferences); const calls = []; let finish;
    const port = { execute: (command, signal) => { calls.push({ command, signal }); return new Promise(resolve => { finish = () => resolve({ version: 'v1', operationId: 'synthetic', revisionId: command.revisionId, status: 'completed', sequence: 3, resultVersion: 1, payloadStatus: 'available', results: [{ kind: 'translation', language: command.targetLanguage, revisionId: command.revisionId, text: 'Synthetic translated fragment', warnings: [] }] }); }); } };
    const scheduler = new EditorScheduler(session, port, surface);
    const first = scheduler.run(); const originalRevision = session.revisionId; const completeFirst = finish;
    assert.equal(calls[0].command.sourceLanguage, 'uk'); assert.equal(calls[0].command.targetLanguage, 'de');
    session.swapTranslation(); assert.notEqual(session.revisionId, originalRevision); assert.equal(calls[0].signal.aborted, true);
    completeFirst(); await first; assert.equal(session.result, undefined); assert.deepEqual(session.preferences, preferences);
    const second = scheduler.run(); assert.equal(calls[1].command.sourceLanguage, 'de'); assert.equal(calls[1].command.targetLanguage, 'uk');
    assert.equal(calls[1].command.input, session.input); assert.deepEqual(calls[1].command.selection, { scope: 'selection', start: 7, end: 18 }); assert.ok(calls[1].command.context);
    finish(); await second; assert.equal(session.result.kind, 'translation'); assert.equal(session.nativeResult, undefined);
    assert.equal(calls.length, 2); assert.equal(session.input, 'Prefix 😀 Selected suffix');
    session.swapTranslation(); assert.equal(session.resultStale, true); assert.equal(calls.length, 2); assert.deepEqual(session.preferences, preferences); scheduler.dispose();
  }
});
