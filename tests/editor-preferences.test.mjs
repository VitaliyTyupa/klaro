import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorSession } from '../packages/editor/src/session.ts';

test('language preference changes invalidate results and preserve drafts', () => {
  const session = new EditorSession();
  session.setInput('Synthetic draft with 😀');
  const original = session.input;
  const revisionId = session.revisionId;
  const result = { kind: 'translation', revisionId, text: 'Synthetic result', warnings: [] };
  assert.equal(session.publish(result), true);
  session.setPreferences({ ...session.preferences, writingLanguages: ['de', 'en'], activeWritingLanguage: 'en' });
  assert.equal(session.input, original);
  assert.notEqual(session.revisionId, revisionId);
  assert.equal(session.resultStale, true);
  assert.equal(session.publish(result), false);
  const current = session.revisionId;
  session.setPreferences(structuredClone(session.preferences));
  assert.equal(session.revisionId, current);
});

test('editor memory clears without persisting drafts', () => {
  const session = new EditorSession();
  session.setInput('Synthetic private draft');
  const revision = session.revisionId;
  session.clear();
  assert.equal(session.input, '');
  assert.notEqual(session.revisionId, revision);
  assert.equal(new EditorSession().input, '');
});
