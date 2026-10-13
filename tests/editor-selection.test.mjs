import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorSession, codePointOffsetToUtf16, utf16OffsetToCodePoint } from '../packages/editor/src/session.ts';

test('UTF-16 selection snapshots survive focus changes and preserve surrogate boundaries', () => {
  const editor = new EditorSession(); editor.setInput('Prefix 😀 selected suffix');
  const start = editor.input.indexOf('😀'), end = editor.input.indexOf(' suffix');
  assert.equal(editor.setSelection(start, end), true);
  const snapshot = editor.snapshot(); assert.equal(editor.selectedInput(), '😀 selected');
  assert.deepEqual(editor.snapshot(), snapshot);
  assert.equal(editor.setSelection(start + 1, end), false);
  assert.throws(() => editor.snapshot());
  assert.equal(editor.setSelection(start, end), true);
  assert.equal(codePointOffsetToUtf16('a😀b', 2), 3); assert.equal(utf16OffsetToCodePoint('a😀b', 3), 2);
  assert.throws(() => utf16OffsetToCodePoint('a😀b', 2));
  editor.setInput('Changed'); assert.deepEqual(editor.selection, { scope: 'document' });
});

test('nearby context is bounded in code points and never splits a surrogate pair', () => {
  const editor = new EditorSession(); editor.setInput('😀'.repeat(5000) + '\nSELECTED\n' + '😀'.repeat(5000));
  const start = editor.input.indexOf('SELECTED'); editor.setSelection(start, start + 8);
  const context = editor.context(); assert.ok(Array.from(context).length <= 4000);
  assert.equal(context.includes('SELECTED'), false);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(context));
  assert.equal(editor.selectedInput(), 'SELECTED');
  assert.ok(Array.from(editor.context(2)).length <= 2);
  editor.clear(); assert.equal(editor.context(), undefined);
});
