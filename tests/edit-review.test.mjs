import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorSession } from '../packages/editor/src/session.ts';

const result = (session, overrides = {}) => ({ kind: 'correction', language: 'en', revisionId: session.revisionId, recommendationId: 'original-recommendation', text: 'I am happy.', editGroups: [{ groupId: 'grammar', edits: [{ span: { start: 2, end: 4 }, original: 'is', replacement: 'am' }] }, { groupId: 'wording', edits: [{ span: { start: 5, end: 9 }, original: 'glad', replacement: 'happy' }] }], warnings: [], ...overrides });

test('independent groups rebuild the recommendation, preserve input and create new recommendation IDs', () => {
  const session = new EditorSession(); session.setInput('I is glad.'); const revision = session.revisionId;
  const base = result(session); session.publish(base, 'source-operation');
  session.publish({ kind: 'translation', language: 'uk', revisionId: revision, recommendationId: base.recommendationId, text: 'Synthetic native', warnings: [] });
  assert.equal(session.reviewEdit('grammar', false), true); assert.equal(session.mainText(), 'I is happy.'); assert.equal(session.input, 'I is glad.'); assert.equal(session.revisionId, revision);
  assert.notEqual(session.result.recommendationId, base.recommendationId); assert.equal(session.nativeResult, undefined); assert.equal(session.nativeStale, true);
  const id = session.result.recommendationId; session.reviewEdit('wording', false); assert.equal(session.mainText(), 'I is glad.'); assert.notEqual(session.result.recommendationId, id);
  session.reviewEdit('grammar', true); assert.equal(session.mainText(), 'I am glad.'); session.reviewEdit('wording', true); assert.equal(session.mainText(), 'I am happy.');
  assert.equal(session.publish(base, 'source-operation'), false); assert.notEqual(session.result.recommendationId, base.recommendationId);
  assert.equal(session.publish({ kind: 'translation', language: 'uk', revisionId: revision, recommendationId: base.recommendationId, text: 'Late obsolete native', warnings: [] }), false);
  assert.equal(session.recommendationOperationId, 'source-operation'); session.setInput('New draft'); assert.equal(session.reviewEdit('grammar', false), false);
  session.clear(); assert.equal(session.recommendationOperationId, undefined);
});

test('dependent logical changes are reviewed together as a canonical compound group', () => {
  const session = new EditorSession(); session.setInput('I has been go.');
  session.publish(result(session, { text: 'I have been going.', editGroups: [{ groupId: 'dependent-grammar', edits: [{ span: { start: 2, end: 13 }, original: 'has been go', replacement: 'have been going' }] }] }));
  session.reviewEdit('dependent-grammar', false); assert.equal(session.mainText(), 'I has been go.');
  session.reviewEdit('dependent-grammar', true); assert.equal(session.mainText(), 'I have been going.'); assert.equal(session.input, 'I has been go.');
});
