import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OperationStream } from '../packages/editor/src/operation-stream.ts';

test('independent operations, duplicates, gaps and recovery keep correlated revisions', () => {
  const stream = new OperationStream();
  const accepted = id => ({ version: 'v1', operationId: id, revisionId: `revision-${id}`, sequence: 0, status: 'accepted', resourceUrl: `/v1/operations/${id}` });
  const event = (id, sequence, result) => ({ version: 'v1', operationId: id, revisionId: `revision-${id}`, sequence, status: result ? 'partially-completed' : 'running', event: result ? 'stage.completed' : 'stage.started', stageId: 'correction', resultVersion: result ? 1 : 0, ...(result ? { result } : {}) });
  stream.accepted(accepted('one')); stream.accepted(accepted('two'));
  assert.equal(stream.event(event('two', 1)), 'applied');
  assert.equal(stream.event(event('two', 1)), 'duplicate');
  const result = { kind: 'translation', revisionId: 'revision-one', text: 'Synthetic', warnings: [] };
  assert.equal(stream.event(event('one', 2, result)), 'snapshot-required');
  assert.deepEqual(stream.results('one', 'revision-one'), []);
  assert.equal(stream.event(event('one', 1)), 'snapshot-required');
  stream.snapshot({ version: 'v1', operationId: 'one', revisionId: 'revision-one', sequence: 3, status: 'completed', resultVersion: 1, payloadStatus: 'available', results: [result] });
  assert.deepEqual(stream.results('one', 'revision-one'), [result]);
  assert.deepEqual(stream.results('one', 'new-revision'), []);
  assert.equal(stream.event(event('one', 2, result)), 'duplicate');
  stream.accepted(accepted('one')); assert.equal(stream.get('one').sequence, 3);
  stream.snapshot({ ...stream.get('one'), payloadStatus: 'expired', results: [] });
  assert.deepEqual(stream.results('one', 'revision-one'), []);
  stream.clear(); assert.equal(stream.get('two'), undefined);
});
