import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import { chromium } from 'playwright';
import { DEFAULT_PREFERENCES } from '@klaro/contracts';

const token = 'a'.repeat(43); const operations = new Map(); let accepts = 0; let cancels = 0; let requests = 0; let active = 0;
const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', request.headers.origin ?? '*');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  requests++;
  let body = ''; for await (const chunk of request) body += chunk;
  let result;
  if (request.url === '/v1/privacy/processing') result = { version: 'synthetic-lifecycle-disclosure', provider: 'test-double', providerRetention: 'Synthetic local fixture only', providerStore: false, backend: { payloadMaximumMinutes: 30, resultMaximumMinutes: 15, digestHours: 24, metadataDays: 30, supplementDays: 7 } };
  else if (request.url === '/auth/extension/exchange') result = { token, expiresAt: new Date(Date.now() + 600000).toISOString() };
  else if (request.url === '/v1/me/preferences') { assert.equal(request.headers.authorization, `Bearer ${token}`); result = DEFAULT_PREFERENCES; }
  else if (request.url === '/v1/operations' && request.method === 'POST') {
    assert.equal(request.headers.authorization, `Bearer ${token}`); accepts++;
    const command = JSON.parse(body); const operationId = randomUUID();
    operations.set(operationId, { version: 'v1', operationId, revisionId: command.revisionId, sequence: 1, status: 'running', resultVersion: 0, payloadStatus: 'available', results: [] });
    result = { version: 'v1', operationId, revisionId: command.revisionId, sequence: 0, status: 'accepted', resourceUrl: `/v1/operations/${operationId}` };
  } else if (request.url.startsWith('/v1/operations/')) {
    const id = request.url.split('/')[3]; result = operations.get(id); assert.ok(result);
    if (request.url.endsWith('/cancel')) { cancels++; result = { ...result, sequence: 2, status: 'cancelled' }; operations.set(id, result); }
  } else { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result));
});
const socketServer = new Server(server, { transports: ['websocket'], cors: { origin: true } });
socketServer.of('/v1/operations').on('connection', socket => { assert.equal(socket.handshake.auth.token, token); active++; socket.on('disconnect', () => active--); });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
execFileSync(process.execPath, ['tools/package-extension.mjs', '--development', `--origin=${origin}`], { stdio: 'inherit' });
const until = async predicate => { for (let index = 0; index < 150; index++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Synthetic lifecycle condition timed out'); };
let context;
try {
  context = await chromium.launchPersistentContext(await mkdtemp('/tmp/klaro-chrome-lifecycle-'), { executablePath: process.env.CHROME_EXECUTABLE_PATH ?? '/usr/bin/google-chrome', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--no-sandbox', '--enable-unsafe-extension-debugging'] });
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve('dist/packages/chrome-development') });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  // The native identity adapter is replaced only in this synthetic auth fixture.
  await page.addInitScript(() => { chrome.identity.launchWebAuthFlow = async () => `${chrome.identity.getRedirectURL('klaro')}?code=synthetic`; });
  await page.goto(`chrome-extension://${id}/index.html`);
  await page.getByRole('button', { name: 'Увійти', exact: true }).click();
  await page.getByRole('button', { name: 'Вийти', exact: true }).waitFor();
  const input = page.getByRole('textbox', { name: 'Вхідний текст', exact: true });
  await input.fill('Synthetic lifecycle draft');
  assert.equal(accepts, 0); assert.equal(active, 0);
  await page.getByRole('button', { name: 'Опрацювати', exact: true }).click();
  await page.getByRole('heading', { name: 'Передача тексту для обробки', exact: true }).waitFor();
  assert.equal(accepts, 0);
  await page.getByRole('button', { name: 'Підтверджую передачу тексту', exact: true }).click();
  await until(() => accepts === 1 && active === 1);
  const workerCdp = await context.newCDPSession(page); const versions = new Map();
  workerCdp.on('ServiceWorker.workerVersionUpdated', ({ versions: values }) => { for (const version of values) versions.set(version.versionId, version); });
  await workerCdp.send('ServiceWorker.enable');
  await until(() => [...versions.values()].some(version => version.scriptURL === `chrome-extension://${id}/service-worker.js` && version.runningStatus === 'running'));
  const version = [...versions.values()].find(version => version.scriptURL === `chrome-extension://${id}/service-worker.js` && version.runningStatus === 'running');
  await workerCdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  await until(() => versions.get(version.versionId)?.runningStatus === 'stopped');
  await workerCdp.send('ServiceWorker.startWorker', { scopeURL: `chrome-extension://${id}/` });
  await until(() => versions.get(version.versionId)?.runningStatus === 'running');
  assert.equal(accepts, 1); assert.equal(active, 1);
  assert.equal(await input.inputValue(), 'Synthetic lifecycle draft');
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await until(() => active === 0 && cancels === 1);
  await input.fill('Synthetic paused draft'); await new Promise(resolve => setTimeout(resolve, 1200)); assert.equal(accepts, 1);
  await page.getByRole('button', { name: 'Автоматично після паузи', exact: true }).click();
  await until(() => accepts === 2 && active === 1);
  await page.evaluate(() => { window.syntheticClosed = false; chrome.sidePanel.onClosed.addListener(() => { window.syntheticClosed = true; }); });
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }, { exclude: true }] });
  const target = targetInfos.find(target => target.url === page.url()); assert.ok(target);
  await cdp.send('Extensions.triggerAction', { id, targetId: target.targetId });
  await page.evaluate(async () => { const current = await chrome.windows.getCurrent(); await chrome.sidePanel.close({ windowId: current.id }); });
  await page.waitForFunction(() => window.syntheticClosed);
  await until(() => active === 0 && cancels === 2);
  await page.getByRole('button', { name: 'Увійти', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
  const stoppedRequests = requests; await new Promise(resolve => setTimeout(resolve, 1200)); assert.equal(requests, stoppedRequests); assert.equal(accepts, 2);
  await page.reload(); assert.equal(await input.inputValue(), '');
  assert.deepEqual(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)]), [[], []]);
  assert.deepEqual(errors, []);
  console.info(`Packaged panel owns socket/token/text; native worker restart, pause, close and reload passed (Chrome ${context.browser().version()})`);
} finally { await context?.close(); await new Promise(resolve => socketServer.close(resolve)); }
