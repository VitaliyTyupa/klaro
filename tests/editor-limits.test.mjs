import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorSession } from '../packages/editor/src/session.ts';

test('Unicode code point limits preserve overlong paste and allow the web limit', () => {
  const editor = new EditorSession();
  for (const [size, panel, web] of [[5000, true, true], [5001, false, true], [20000, false, true], [20001, false, false]]) {
    const text = '😀'.repeat(size); editor.setInput(text);
    assert.equal(editor.count(), size); assert.equal(editor.input, text);
    assert.equal(editor.withinLimit('panel'), panel); assert.equal(editor.withinLimit('web'), web);
  }
  editor.setInput('a\u0301'); assert.equal(editor.count(), 2);
});

test('native rendering attaches only to the current correction recommendation', () => {
  const editor = new EditorSession(); editor.setInput('Synthetic');
  const correction = { kind: 'correction', revisionId: editor.revisionId, recommendationId: 'current', text: 'Synthetic correction', editGroups: [], warnings: [] };
  editor.publish(correction);
  assert.equal(editor.publish({ kind: 'translation', revisionId: editor.revisionId, recommendationId: 'old', text: 'Old translation', warnings: [] }), false);
  assert.equal(editor.publish({ kind: 'translation', revisionId: editor.revisionId, recommendationId: 'current', text: 'Native rendering', warnings: [] }), true);
  assert.equal(editor.mainText(), 'Synthetic correction'); assert.equal(editor.nativeResult.text, 'Native rendering');
  editor.clear(); assert.equal(editor.nativeResult, undefined);
});
