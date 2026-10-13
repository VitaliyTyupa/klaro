import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorSession } from '../packages/editor/src/session.ts';

test('originals remain bounded in session memory and restore creates a fresh revision', () => {
  const session = new EditorSession();
  for (let index = 0; index < 12; index++) { session.setInput(`Synthetic original ${index}`); session.rememberOriginal(); }
  assert.equal(session.originals.length, 10); assert.equal(session.originals[0].text, 'Synthetic original 2');
  session.rememberOriginal(); assert.equal(session.originals.length, 10);
  const original = session.originals[0], revision = session.revisionId;
  assert.equal(session.restoreOriginal(original.id), true); assert.equal(session.input, original.text); assert.notEqual(session.revisionId, revision);
  const restored = session.revisionId; session.restoreOriginal(original.id); assert.notEqual(session.revisionId, restored);
  assert.equal(session.restoreOriginal('unknown'), false);
  assert.deepEqual(new EditorSession().originals, []);
  session.clear(); assert.deepEqual(session.originals, []); assert.equal(session.input, '');
});
