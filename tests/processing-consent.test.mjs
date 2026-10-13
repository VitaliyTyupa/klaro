import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProcessingConsent } from '../packages/editor/src/processing-consent.ts';
import { ApiOperationClient } from '../packages/editor/src/api-client.ts';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { processingDisclosure, RETENTION } = require('../dist/api/privacy/config.js');
const turn = () => new Promise(resolve => setImmediate(resolve));

test('disclosure reflects runtime provider and payload limits without inferring retention', () => {
  const disabled = processingDisclosure({}); const double = processingDisclosure({ AI_PROVIDER: 'double' });
  const openai = processingDisclosure({ AI_PROVIDER: 'openai' });
  assert.equal(disabled.provider, 'disabled'); assert.equal(double.provider, 'test-double');
  assert.match(openai.providerRetention, /не підтверджені/); assert.equal(openai.providerStore, false);
  assert.equal(openai.backend.payloadMaximumMinutes * 60000, RETENTION.payloadMs);
  assert.equal(openai.backend.resultMaximumMinutes * 60000, RETENTION.resultMs);
  const reviewed = processingDisclosure({ AI_PROVIDER: 'openai', PROVIDER_RETENTION_NOTICE: 'Verified deployment retention settings' });
  assert.notEqual(reviewed.version, openai.version); assert.equal(reviewed.providerRetention, 'Verified deployment retention settings');
});

test('no operation text leaves before confirmation; cancellation, expiry and changed config require consent', async () => {
  let version = 'first'; const requests = [];
  const consent = new ProcessingConsent('', () => {}, async (url, init) => { requests.push({ url, init }); return Response.json({ ...processingDisclosure({ AI_PROVIDER: 'double' }), version }); });
  const client = new ApiOperationClient('', () => ({}), async (url, init) => { requests.push({ url, init }); throw new Error('transport reached'); });
  client.authorize = signal => consent.authorize(signal);
  const command = { input: 'PRIVATE CANARY' }; const controller = new AbortController();
  const first = client.execute(command, controller.signal, () => {}).catch(error => error);
  await turn(); assert.equal(consent.pending, true); assert.equal(requests.length, 1);
  assert.equal(requests[0].init.body, undefined); assert.equal(JSON.stringify(requests).includes('PRIVATE CANARY'), false);
  consent.decide(false); assert.match((await first).message, /cancelled/); assert.equal(requests.length, 1);
  const second = client.execute(command, controller.signal, () => {}).catch(error => error); await turn(); consent.decide(true);
  assert.match((await second).message, /transport reached/); assert.equal(requests.at(-1).init.body, JSON.stringify(command));
  await consent.authorize(controller.signal); assert.equal(consent.pending, false);
  version = 'changed'; const changed = consent.authorize(controller.signal).catch(error => error); await turn(); assert.equal(consent.pending, true);
  controller.abort(); await changed; assert.equal(consent.pending, false);
  consent.reset(); const fresh = consent.authorize(new AbortController().signal).catch(error => error); await turn(); assert.equal(consent.pending, true); consent.reset(); assert.match((await fresh).message, /cancelled/);
});
