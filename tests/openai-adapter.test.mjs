import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PREFERENCES, OperationResultSchema } from '@klaro/contracts';
import { OpenAiResponsesAdapter, responseSchema } from '../dist/api/ai/openai-responses.js';
const command = { version: 'v1', clientRequestId: 'client-one', revisionId: 'revision-one', operationType: 'translation', surface: 'web', input: 'Outside private prefix | SELECTED | Outside suffix', selection: { scope: 'selection', start: 25, end: 33 }, preferences: DEFAULT_PREFERENCES, sourceLanguage: 'uk', targetLanguage: 'de', protectedSpans: [] };
const task = { command, stageId: 'translation', resultKind: 'translation', text: 'SELECTED', sourceLanguage: 'uk', targetLanguage: 'de', policy: { version: 'synthetic-policy-v1', provider: 'openai', model: 'synthetic-model', structuredOutputs: true, inputTokenLimit: 128000, outputTokenLimit: 512, timeoutMs: 1000 } };
const result = { kind: 'translation', language: 'de', revisionId: 'revision-one', recommendationId: null, text: 'Synthetic response', warnings: [] };
const response = overrides => new Response(JSON.stringify({ id: 'resp_synthetic', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }], usage: { input_tokens: 10, output_tokens: 20 }, ...overrides }), { status: 200 });

test('recorded Responses request is stateless, bounded, structured and contains only selected input', async () => {
  const recorded = [];
  const adapter = new OpenAiResponsesAdapter('synthetic-key-only', async (url, options) => { recorded.push({ url, options }); return response(); });
  const value = await adapter.execute(task, new AbortController().signal);
  OperationResultSchema.parse(value.candidate); assert.equal(value.usage.outputTokens, 20);
  assert.equal(recorded.length, 1); assert.equal(recorded[0].url, 'https://api.openai.com/v1/responses');
  const body = JSON.parse(recorded[0].options.body);
  assert.equal(body.store, false); assert.equal(body.max_output_tokens, 512); assert.equal(body.truncation, 'disabled');
  assert.equal(body.text.format.strict, true); assert.equal(body.text.format.type, 'json_schema');
  for (const field of ['tools', 'background', 'conversation', 'previous_response_id', 'metadata']) assert.equal(field in body, false);
  assert.equal(JSON.stringify(body).includes('Outside private prefix'), false);
  assert.equal(JSON.stringify(body).includes('Outside suffix'), false);
  assert.equal(recorded[0].options.redirect, 'error');
  assert.ok(recorded[0].options.signal instanceof AbortSignal);
  for (const kind of ['correction', 'alternatives', 'translation', 'explanation', 'lexical']) {
    const validate = schema => { if (schema.type === 'object') { assert.equal(schema.additionalProperties, false); assert.deepEqual(schema.required.sort(), Object.keys(schema.properties).sort()); Object.values(schema.properties).forEach(validate); } if (schema.items) validate(schema.items); };
    validate(responseSchema(kind));
  }
});

test('refusal, incomplete output, invalid JSON and errors do not trigger hidden retries', async () => {
  for (const [payload, outcome] of [[{ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Synthetic refusal' }] }] }, 'refusal'], [{ status: 'incomplete' }, 'incomplete'], [{ output: [{ type: 'message', content: [{ type: 'output_text', text: 'invalid-json' }] }] }, 'complete']]) {
    let attempts = 0;
    const adapter = new OpenAiResponsesAdapter('synthetic-key-only', async () => { attempts++; return response(payload); });
    const value = await adapter.execute(task, new AbortController().signal);
    assert.equal(value.outcome, outcome); assert.equal(attempts, 1);
    if (payload.output?.[0].content[0].text === 'invalid-json') assert.equal(value.candidate, undefined);
  }
  let attempts = 0;
  const error = new OpenAiResponsesAdapter('synthetic-key-only', async () => { attempts++; return new Response('Synthetic private provider error', { status: 429 }); });
  await assert.rejects(error.execute(task, new AbortController().signal), value => value.code === 'provider-error' && !value.message.includes('private'));
  assert.equal(attempts, 1);
  const timeout = new OpenAiResponsesAdapter('synthetic-key-only', async () => new Promise(resolve => setTimeout(() => resolve(response()), 50)));
  await assert.rejects(timeout.execute({ ...task, policy: { ...task.policy, timeoutMs: 5 } }, new AbortController().signal), value => value.code === 'indeterminate');
});
