import assert from 'node:assert/strict';
import { createServer, request as proxyRequest } from 'node:http';
import { once } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import pg from 'pg';
import { createClient } from 'redis';
import { startOidcProvider } from './oidc-provider.fixture.mjs';
import { attachPanel } from './cdp-panel.fixture.mjs';
import { runBrowserMatrix } from './browser-matrix.fixture.mjs';

const browserKind = process.env.KLARO_BROWSER ?? 'chrome'; assert.ok(['chrome', 'edge'].includes(browserKind));
const partial = process.env.KLARO_MATRIX_PARTIAL === '1';
const partialSurface = process.env.KLARO_PARTIAL_SURFACE ?? 'panel';
assert.ok(['panel', 'web'].includes(partialSurface));
const executablePath = browserKind === 'edge' ? process.env.EDGE_EXECUTABLE_PATH ?? '/usr/bin/microsoft-edge' : process.env.CHROME_EXECUTABLE_PATH ?? '/usr/bin/google-chrome';
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro';
const database = new pg.Client({ connectionString: databaseUrl }); await database.connect();
const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6380' }); await redis.connect();
const provider = await startOidcProvider(); const subject = `synthetic-e2e-${randomUUID()}`; provider.setSubject(subject);
let apiPort; let child; let context; const operationRequests = []; const upstreamSockets = new Set();
let upgradeConnections = 0; let disconnectNextUpgrade = false; let holdRecovery = false;
const webRoot = resolve('dist/web/browser');
const proxy = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path.startsWith('/auth/') || path.startsWith('/v1/') || path === '/health') {
    if (path === '/v1/operations' && request.method === 'POST') operationRequests.push({ surface: request.headers.authorization ? 'panel' : 'web' });
    const upstream = proxyRequest({ hostname: '127.0.0.1', port: apiPort, path: request.url, method: request.method, headers: request.headers }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers);
      if (holdRecovery && request.method === 'GET' && path.startsWith('/v1/operations/')) {
        // Simulate a brief recovery-channel outage until the browser reconnects.
        const deadline = Date.now() + 5000;
        const timer = setInterval(() => { if (upgradeConnections >= 2 || Date.now() >= deadline) { clearInterval(timer); incoming.pipe(response); } }, 20);
        response.on('close', () => { clearInterval(timer); incoming.destroy(); });
      } else incoming.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(502); response.end(); }); request.pipe(upstream); return;
  }
  try {
    if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const file = extname(path) ? resolve(webRoot, `.${path}`) : resolve(webRoot, 'index.html'); if (!file.startsWith(`${webRoot}/`)) throw new Error('Invalid path');
    response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html'); response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
proxy.on('upgrade', (request, socket, head) => {
  const upstream = proxyRequest({ hostname: '127.0.0.1', port: apiPort, path: request.url, headers: request.headers });
  upstream.on('upgrade', (response, remote, remoteHead) => {
    upgradeConnections++;
    upstreamSockets.add(socket); upstreamSockets.add(remote);
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}\r\n`).join('')}\r\n`);
    if (head.length) remote.write(head); if (remoteHead.length) socket.write(remoteHead); remote.pipe(socket); socket.pipe(remote);
    for (const stream of [socket, remote]) { stream.on('close', () => upstreamSockets.delete(stream)); stream.on('error', () => { socket.destroy(); remote.destroy(); }); }
    if (disconnectNextUpgrade) { disconnectNextUpgrade = false; setTimeout(() => { socket.destroy(); remote.destroy(); }, 50); }
  }); upstream.on('error', () => socket.destroy()); upstream.end();
});
proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening'); const origin = `http://127.0.0.1:${proxy.address().port}`;
const until = async (predicate, description) => { for (let index = 0; index < 150; index++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error(`Timed out: ${description}`); };
const users = [];
try {
  execFileSync(process.execPath, ['tools/package-extension.mjs', '--development', `--browser=${browserKind}`, `--origin=${origin}`], { stdio: 'inherit' });
  context = await chromium.launchPersistentContext(await mkdtemp('/tmp/klaro-correction-e2e-'), { executablePath, headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--no-sandbox', '--enable-unsafe-extension-debugging'] });
  const cdp = await context.browser().newBrowserCDPSession(); const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve(`dist/packages/${browserKind}-development`) });
  const anchor = await context.newPage(); await anchor.goto(`chrome-extension://${id}/index.html`);
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }, { exclude: true }] });
  const target = targetInfos.find(target => target.url === anchor.url()); assert.ok(target);
  await cdp.send('Extensions.triggerAction', { id, targetId: target.targetId });
  await new Promise(resolve => setTimeout(resolve, 300));
  const anchorCdp = await context.newCDPSession(anchor); const { targetInfo: anchorTarget } = await anchorCdp.send('Target.getTargetInfo');
  const nativeTarget = (await cdp.send('Target.getTargets')).targetInfos.find(target => target.type === 'page' && target.targetId !== anchorTarget.targetId && target.url.startsWith(`chrome-extension://${id}/index.html`));
  assert.ok(nativeTarget); const panel = await attachPanel(cdp, nativeTarget.targetId);
  const callback = await panel.evaluate(() => chrome.identity.getRedirectURL('klaro'));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); apiPort = probe.address().port; await new Promise(resolve => probe.close(resolve));
  child = spawn(process.execPath, ['dist/api/main.js'], { env: { ...process.env, NODE_ENV: 'test', PORT: String(apiPort), APP_ORIGIN: origin, OIDC_ISSUER: provider.issuer, OIDC_CLIENT_ID: 'klaro-test', OIDC_ALLOW_LOOPBACK_HTTP: 'true', EXTENSION_CALLBACKS: callback, EXTENSION_ORIGINS: `chrome-extension://${id}`, AI_PROVIDER: 'double', AI_DOUBLE_NATIVE_INCOMPLETE_ONCE: partial ? 'true' : 'false', OPERATION_HMAC_KEY: randomBytes(32).toString('hex') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', value => { logs += value; }); child.stderr.on('data', value => { logs += value; });
  await until(async () => { if (child.exitCode !== null) throw new Error('API bootstrap failed'); try { return (await fetch(`${origin}/health`)).ok; } catch { return false; } }, 'API readiness');
  const errors = []; for (const page of [panel]) page.on('pageerror', error => errors.push(error.message));
  await panel.getByRole('button', { name: 'Увійти', exact: true }).click();
  await panel.getByRole('button', { name: 'Вийти', exact: true }).waitFor({ timeout: 15000 });
  assert.equal(provider.exchanges(), 1);
  const user = (await database.query('SELECT user_id FROM klaro.external_identities WHERE issuer = $1 AND subject = $2', [provider.issuer, subject])).rows[0].user_id; users.push(user);
  const web = await context.newPage(); web.on('pageerror', error => errors.push(error.message)); await web.goto(`${origin}/auth/login`);
  await web.getByRole('button', { name: 'Вийти', exact: true }).waitFor(); assert.equal(provider.exchanges(), 2);
  const unrelated = await context.newPage(); await unrelated.goto('data:text/html,<title>Unrelated synthetic page</title><textarea aria-label="Other site input"></textarea>'); await unrelated.getByRole('textbox').fill('Unrelated page canary never pasted into Klaro');
  assert.equal(operationRequests.length, 0);
  const original = 'Synthetic original 😀 ABC-123';
  const surfaces = partialSurface === 'web' ? [['web', web], ['panel', panel]] : [['panel', panel], ['web', web]];
  for (const [surface, page] of surfaces) {
    const input = page.getByRole('textbox', { name: 'Вхідний текст', exact: true }); await input.fill(original);
    const overlong = '😀'.repeat(surface === 'panel' ? 5001 : 20001); await input.fill(overlong);
    assert.equal(await input.inputValue(), overlong);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Опрацювати').disabled), true);
    await input.fill(original);
    await page.evaluate(() => { const write = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = async text => { await write(text); window.syntheticCopied = text; }; });
    if (surface === 'panel') { disconnectNextUpgrade = true; holdRecovery = true; }
    await page.getByRole('button', { name: 'Опрацювати', exact: true }).click();
    await page.getByRole('button', { name: 'Підтверджую передачу тексту' }).click();
    if (partial && surface === partialSurface) {
      await page.getByText('Не вдалося перекласти рекомендацію. Основний результат доступний.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('textbox', { name: 'Рекомендація', exact: true }).inputValue(), original);
      await page.getByRole('button', { name: 'Повторити лише переклад рекомендації', exact: true }).click();
    }
    await page.waitForFunction(expected => document.querySelectorAll('textarea')[1]?.value === expected && document.querySelectorAll('textarea')[2]?.value === expected, original);
    assert.equal(await input.inputValue(), original); assert.equal(await page.getByRole('button', { name: 'Копіювати результат', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Копіювати результат', exact: true }).click();
    await page.getByText('Основний результат скопійовано.', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.syntheticCopied), original);
    const operation = (await database.query("SELECT id FROM klaro.operations WHERE user_id = $1 AND operation_type = 'correction' ORDER BY created_at DESC LIMIT 1", [user])).rows[0].id;
    assert.equal(Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE operation_id = $1', [operation])).rows[0].count), 2);
    assert.equal(Number((await database.query('SELECT count(*) FROM klaro.operation_feedback WHERE operation_id = $1', [operation])).rows[0].count), 0);
    await page.getByRole('button', { name: 'Корисний результат', exact: true }).click();
    await page.getByText('Дякуємо за оцінку.', { exact: true }).waitFor();
    const feedback = (await database.query('SELECT operation_id,reason FROM klaro.operation_feedback WHERE user_id = $1 AND operation_id = $2', [user, operation])).rows;
    assert.deepEqual(feedback, [{ operation_id: operation, reason: 'helpful' }]);
    assert.equal(Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE operation_id = $1', [operation])).rows[0].count), 2);
    const expectedRequests = partial && surface === partialSurface ? 2 : 1;
    assert.equal(operationRequests.filter(value => value.surface === surface).length, expectedRequests);
    if (surface === 'panel') { assert.ok(upgradeConnections >= 2); holdRecovery = false; }
    await page.screenshot({ path: `/tmp/klaro-correction-e2e-${surface}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Перекладач', exact: true }).click();
    await page.getByRole('textbox', { name: 'Переклад', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox').count(), 2);
    await page.getByText('Українська → Німецька', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Змінити напрямок', exact: true }).click();
    await page.getByText('Німецька → Українська', { exact: true }).waitFor();
    await input.fill('Synthetic selection 3 suffix');
    await page.evaluate(() => { const input = document.querySelector('textarea'); input.setSelectionRange(10, 21); input.dispatchEvent(new Event('select', { bubbles: true })); });
    await page.getByRole('button', { name: 'Опрацювати', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('textarea')[1]?.value === 'selection 3');
    await page.getByRole('button', { name: 'Копіювати результат', exact: true }).click();
    await page.waitForFunction(() => window.syntheticCopied === 'selection 3');
    assert.equal(await input.inputValue(), 'Synthetic selection 3 suffix');
    const translation = (await database.query('SELECT id FROM klaro.operations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [user])).rows[0].id;
    assert.equal(Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE operation_id = $1', [translation])).rows[0].count), 1);
    assert.equal(operationRequests.filter(value => value.surface === surface).length, expectedRequests + 1);
    await page.getByRole('button', { name: 'Змінити напрямок', exact: true }).click();
    await page.getByText('Результат неактуальний після зміни тексту або налаштувань.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Копіювати результат', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Корекція', exact: true }).click();
  }
  const attempts = Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE user_id = $1', [user])).rows[0].count);
  assert.equal(attempts, partial ? 7 : 6);
  await database.query("UPDATE klaro.budget_accounts SET spent_tokens = 5000000 WHERE user_id = $1 AND budget_day = (now() AT TIME ZONE 'UTC')::date", [user]);
  await web.getByRole('textbox', { name: 'Вхідний текст', exact: true }).fill('Synthetic quota-preserved draft'); await web.getByRole('button', { name: 'Опрацювати', exact: true }).click();
  await web.getByText('Досягнуто ліміту запитів або доступного бюджету. Чернетку збережено; зачекайте або перевірте використання в акаунті.', { exact: true }).waitFor();
  assert.equal(await web.getByRole('textbox', { name: 'Вхідний текст', exact: true }).inputValue(), 'Synthetic quota-preserved draft');
  assert.equal(Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE user_id = $1', [user])).rows[0].count), attempts);
  for (const page of [panel, web]) { await page.getByRole('button', { name: 'Вийти', exact: true }).click(); await page.waitForFunction(() => document.querySelector('textarea')?.value === ''); assert.deepEqual(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)]), [[], []]); }
  assert.equal(Number((await database.query('SELECT count(*) FROM klaro.sessions WHERE user_id = $1 AND revoked_at IS NULL', [user])).rows[0].count), 0);
  await panel.getByRole('button', { name: 'Увійти', exact: true }).click();
  await panel.getByRole('button', { name: 'Вийти', exact: true }).waitFor(); assert.equal(provider.exchanges(), 3);
  await panel.getByRole('textbox', { name: 'Вхідний текст', exact: true }).fill('Synthetic close draft');
  await panel.evaluate(() => document.querySelector('button[aria-pressed]')?.click());
  const requestsBeforeClose = operationRequests.length;
  await anchor.evaluate(async () => { const window = await chrome.windows.getCurrent(); await chrome.sidePanel.close({ windowId: window.id }); });
  await until(async () => !(await cdp.send('Target.getTargets')).targetInfos.some(value => value.targetId === nativeTarget.targetId), 'native panel document closed');
  await cdp.send('Extensions.triggerAction', { id, targetId: target.targetId });
  let reopenedTarget;
  await until(async () => { reopenedTarget = (await cdp.send('Target.getTargets')).targetInfos.find(value => value.type === 'page' && value.targetId !== anchorTarget.targetId && value.url.startsWith(`chrome-extension://${id}/index.html`)); return Boolean(reopenedTarget); }, 'native panel reopened');
  const reopened = await attachPanel(cdp, reopenedTarget.targetId);
  await reopened.getByRole('button', { name: 'Увійти', exact: true }).waitFor();
  assert.equal(await reopened.getByRole('textbox', { name: 'Вхідний текст', exact: true }).inputValue(), '');
  assert.deepEqual(await reopened.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)]), [[], []]);
  await new Promise(resolve => setTimeout(resolve, 1200)); assert.equal(operationRequests.length, requestsBeforeClose);
  assert.ok(!logs.includes(original));
  const keys = await redis.keys(`klaro:payload:${user}:*`); if (keys.length) assert.ok((await redis.mGet(keys)).every(value => !value?.includes('Unrelated page canary')));
  assert.deepEqual(errors, []); console.info(`Native ${browserKind} identity/OIDC + panel/web correction, reconnect, native copy, quota, logout and close/reopen passed (${context.browser().version()})`);
  if (partial) {
    await mkdir('docs/evaluations/browser-matrix', { recursive: true });
    await writeFile(`docs/evaluations/browser-matrix/${browserKind}-${partialSurface}-partial.json`, `${JSON.stringify({ testedAt: new Date().toISOString(), browser: browserKind, version: context.browser().version(), provider: 'double', partialSurface, recommendationPreserved: true, nativeOnlyRetry: true, attempts: 7, reconnect: true, copy: true, quota: true, logout: true, closeReopen: true }, null, 2)}\n`);
  }
  if (process.env.KLARO_BROWSER_MATRIX === '1') {
    for (const [surface, page] of [['panel', reopened], ['web', web]]) {
      await runBrowserMatrix({ evaluate: (fn, value) => page.evaluate(fn, value), click: name => page.getByRole('button', { name, exact: true }).click(), login: async () => {
        if (surface === 'web') await web.goto(`${origin}/auth/login`);
        else await page.getByRole('button', { name: 'Увійти', exact: true }).click();
        await page.getByRole('button', { name: 'Вийти', exact: true }).waitFor({ timeout: 15000 });
      }, database, databaseUrl, redis, provider, surface, browser: browserKind, version: context.browser().version() });
    }
  }
} finally {
  await context?.close(); for (const socket of upstreamSockets) socket.destroy(); proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve));
  if (child) { child.kill(); if (child.exitCode === null) await once(child, 'exit'); }
  const found = (await database.query('SELECT user_id FROM klaro.external_identities WHERE issuer = $1 AND subject = $2', [provider.issuer, subject])).rows.map(row => row.user_id);
  for (const user of new Set([...users, ...found])) { const keys = await redis.keys(`klaro:payload:${user}:*`); if (keys.length) await redis.del(keys); await database.query('DELETE FROM klaro.users WHERE id = $1', [user]); }
  await provider.close(); await redis.close(); await database.end();
}
