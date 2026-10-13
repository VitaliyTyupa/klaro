import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiOperationClient } from '../packages/editor/src/api-client.ts';
import { PanelLifecycle } from '../apps/extension/src/lifecycle.ts';

const command = { version: 'v1', clientRequestId: 'request', revisionId: 'revision', operationType: 'correction', surface: 'panel' };
const accepted = { version: 'v1', operationId: 'operation', revisionId: 'revision', status: 'accepted', sequence: 0, resourceUrl: '/v1/operations/operation' };
const state = (sequence, status = 'running') => ({ version: 'v1', operationId: 'operation', revisionId: 'revision', sequence, status, resultVersion: 0, payloadStatus: 'available', results: [] });
const event = sequence => ({ version: 'v1', operationId: 'operation', revisionId: 'revision', sequence, status: 'running', event: 'stage.started', stageId: 'correction', resultVersion: 0 });
const turn = () => new Promise(resolve => setImmediate(resolve));
test('feedback sends only explicit metadata and is aborted with the panel lifetime', async () => {
  const requests = []; let requestSignal;
  const client = new ApiOperationClient('', () => ({ 'X-CSRF-Token': 'synthetic-csrf' }), async (url, init) => {
    requests.push({ url, init }); requestSignal = init.signal;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  });
  assert.equal(requests.length, 0);
  const pending = client.submitFeedback('00000000-0000-4000-8000-000000000001', 'meaning', new AbortController().signal);
  await turn(); assert.deepEqual(JSON.parse(requests[0].init.body), { reason: 'meaning' });
  assert.equal(requests[0].init.headers['X-CSRF-Token'], 'synthetic-csrf');
  client.dispose(); await assert.rejects(pending); assert.equal(requestSignal.aborted, true);
  await assert.rejects(client.submitFeedback('00000000-0000-4000-8000-000000000001', 'meaning', new AbortController().signal));
  assert.equal(requests.length, 1);
});
function socketFixture() {
  const listeners = new Map();
  return { connects: 0, disconnects: 0, on(event, listener) { listeners.set(event, listener); return this; }, removeAllListeners() { listeners.clear(); return this; }, connect() { this.connects++; this.fire('connect'); return this; }, disconnect() { this.disconnects++; return this; }, fire(event, value) { listeners.get(event)?.(value); } };
}

test('socket events reconcile gaps and reconnect snapshots without another acceptance', async () => {
  const socket = socketFixture(); const requests = []; const published = []; let snapshot = state(1); let auth;
  const client = new ApiOperationClient('https://synthetic.test', () => ({ Authorization: 'Bearer synthetic-token' }), async (url, init) => { requests.push({ url, init }); return Response.json(init.method === 'POST' ? accepted : snapshot); }, async (_origin, value) => { auth = value; return socket; });
  const running = client.execute(command, new AbortController().signal, value => published.push(value));
  await turn(); assert.deepEqual(auth, { token: 'synthetic-token' });
  socket.fire('operation.event', event(2)); socket.fire('operation.event', event(2));
  assert.equal(published.filter(value => value.sequence === 2).length, 1);
  socket.fire('operation.event', { ...event(3), revisionId: 'unrelated' }); assert.equal(published.at(-1).sequence, 2);
  snapshot = state(4); socket.fire('operation.event', event(4)); await turn(); assert.equal(published.at(-1).sequence, 4);
  snapshot = state(5, 'completed'); socket.fire('connect'); await turn();
  assert.equal((await running).status, 'completed');
  assert.equal(requests.filter(request => request.init.method === 'POST').length, 1);
  assert.equal(socket.connects, 1); assert.ok(socket.disconnects >= 1);
  const count = published.length; socket.fire('operation.event', event(6)); assert.equal(published.length, count);
});

test('pause and close abort transport, cancel once and forbid late or new document requests', async () => {
  const socket = socketFixture(); const requests = []; const published = [];
  const client = new ApiOperationClient('', () => ({ 'X-CSRF-Token': 'synthetic-csrf' }), async (url, init) => { requests.push({ url, init }); return Response.json(url.endsWith('/cancel') ? state(2, 'cancelled') : init.method === 'POST' ? accepted : state(1)); }, async () => socket);
  const running = client.execute(command, new AbortController().signal, value => published.push(value)).catch(error => error);
  await turn(); client.suspend(); await running;
  assert.equal(requests.filter(request => request.url.endsWith('/cancel')).length, 1);
  const count = requests.length; const publishedCount = published.length;
  socket.fire('connect'); socket.fire('operation.event', event(2)); await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(requests.length, count); assert.equal(published.length, publishedCount); assert.ok(socket.disconnects >= 1);
  const cleared = []; const lifecycle = new PanelLifecycle({ disposeOperations: () => { client.dispose(); cleared.push('socket'); }, clearAuthentication: () => cleared.push('token'), clearText: () => cleared.push('text'), notifyClosed: () => cleared.push('status') });
  lifecycle.close(); lifecycle.close(); assert.deepEqual(cleared, ['socket', 'token', 'text', 'status']);
  await assert.rejects(client.execute(command, new AbortController().signal, () => {}), /Closed/); assert.equal(requests.length, count);
});

test('closing during lazy socket initialization never connects the late socket', async () => {
  let finish; const socket = socketFixture(); let cancellations = 0;
  const client = new ApiOperationClient('', () => ({}), async url => { if (url.endsWith('/cancel')) cancellations++; return Response.json(accepted); }, () => new Promise(resolve => { finish = resolve; }));
  const running = client.execute(command, new AbortController().signal, () => {}).catch(error => error);
  await turn(); client.dispose(); finish(socket); await running;
  assert.equal(socket.connects, 0); assert.equal(cancellations, 1); assert.equal(socket.disconnects, 1);
});
