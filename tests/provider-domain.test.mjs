import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { workflowFor } from '../apps/api/src/ai/workflows.ts';
import { DeterministicProvider } from '../apps/api/src/ai/double.ts';
import { DEFAULT_PREFERENCES, OperationResultSchema } from '@klaro/contracts';

test('domain workflows remain fixed and provider-independent', async () => {
  const provider = new DeterministicProvider();
  const command = { operationType: 'correction', revisionId: 'revision-one', preferences: DEFAULT_PREFERENCES };
  const workflow = workflowFor(command);
  assert.deepEqual(workflow.stages.map(stage => stage.id), ['correction', 'native-rendering']);
  assert.equal(workflowFor({ ...command, operationType: 'back-translation' }).stages.length, 1);
  assert.equal(workflowFor({ ...command, operationType: 'explanation' }).stages.length, 1);
  assert.ok(Object.isFrozen(workflow) && Object.isFrozen(workflow.stages));
  const result = await provider.execute({ command, stageId: 'correction', resultKind: 'correction', text: 'Synthetic', sourceLanguage: 'de', targetLanguage: 'de', policy: { version: 'synthetic-v1' } }, new AbortController().signal);
  OperationResultSchema.parse(result.candidate);
  assert.equal(result.candidate.text, 'Synthetic');
  assert.equal(provider.attempts.length, 1);
  const source = readFileSync('apps/api/src/operations/service.ts', 'utf8');
  assert.ok(!/from ['"](?:openai|@anthropic|@google)/.test(source));
});

test('synthetic native incomplete fixture settles known usage once and requires an explicit next call', async () => {
  const provider = new DeterministicProvider(0, true);
  const task = { command: { revisionId: 'synthetic' }, stageId: 'native-rendering', resultKind: 'translation', text: 'Synthetic 3', targetLanguage: 'uk', policy: { version: 'synthetic' } };
  const signal = new AbortController().signal;
  const first = await provider.execute(task, signal); assert.equal(first.outcome, 'incomplete'); assert.equal(first.usage.outputTokens, 0); assert.equal(provider.attempts.length, 1);
  assert.equal((await provider.execute(task, signal)).outcome, 'complete'); assert.equal(provider.attempts.length, 2);
});
