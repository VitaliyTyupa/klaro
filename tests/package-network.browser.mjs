import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchFirefox } from './firefox.fixture.mjs';

const results = [];
for (const browser of ['chrome', 'edge']) {
  const context = await chromium.launchPersistentContext(await mkdtemp(`/tmp/klaro-audit-${browser}-`), { executablePath: browser === 'chrome' ? '/usr/bin/google-chrome' : '/usr/bin/microsoft-edge', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--no-sandbox', '--enable-unsafe-extension-debugging'] });
  try {
    const requests = [];
    context.on('request', request => { const url = new URL(request.url()); if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) requests.push({ origin: url.origin, method: request.method(), resourceType: request.resourceType() }); });
    const cdp = await context.browser().newBrowserCDPSession();
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: resolve(`dist/packages/${browser}`) });
    const page = await context.newPage(); await page.goto(`chrome-extension://${loaded.id}/index.html`);
    await page.getByRole('textbox', { name: 'Вхідний текст', exact: true }).fill('Synthetic network canary');
    await page.waitForTimeout(1200);
    assert.ok(requests.every(r => r.origin === 'https://klaro.example' && r.method === 'GET'));
    assert.deepEqual(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)]), [[], []]);
    const observed = [...requests];
    await page.evaluate(() => fetch('https://klaro.example/audit-observer-canary', { signal: AbortSignal.timeout(1000) }).catch(() => {}));
    assert.ok(requests.length > observed.length, 'Network observer must detect a harness-only canary');
    results.push({ browser, version: context.browser().version(), scenario: 'production package open + manual typing without login or send', requests: observed, observerVerified: true, passed: true });
  } finally { await context.close(); }
}
const firefox = await launchFirefox();
try {
  await firefox.context('chrome');
  await firefox.evaluate(`window.klaroAudit = []; window.klaroObserver = { observe(subject) { const channel = subject.QueryInterface(Ci.nsIHttpChannel); const principal = channel.loadInfo?.loadingPrincipal?.origin ?? ''; if (principal.startsWith('moz-extension:')) window.klaroAudit.push({ origin: new URL(channel.URI.spec).origin, method: channel.requestMethod }); } }; Services.obs.addObserver(window.klaroObserver, 'http-on-modify-request');`);
  await firefox.command('POST', '/moz/addon/install', { path: resolve('dist/packages/firefox'), temporary: true });
  let ready = false;
  for (let i = 0; i < 200; i++) { if (await firefox.panel(() => Boolean(document.querySelector('textarea')))) { ready = true; break; } await new Promise(resolve => setTimeout(resolve, 40)); }
  assert.ok(ready);
  await firefox.panel(() => { const input = document.querySelector('textarea'); input.value = 'Synthetic network canary'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await new Promise(resolve => setTimeout(resolve, 1200));
  const requests = await firefox.evaluate('return window.klaroAudit');
  assert.ok(requests.every(r => r.origin === 'https://klaro.example' && r.method === 'GET'));
  assert.deepEqual(await firefox.panel(() => [Object.keys(localStorage), Object.keys(sessionStorage)]), [[], []]);
  await firefox.panel(() => { void fetch('https://klaro.example/audit-observer-canary', { signal: AbortSignal.timeout(1000) }).catch(() => {}); });
  await new Promise(resolve => setTimeout(resolve, 1100));
  const probeRequests = await firefox.evaluate('return window.klaroAudit');
  assert.ok(probeRequests.length > requests.length, 'Firefox network observer must detect a harness-only canary');
  await firefox.evaluate("Services.obs.removeObserver(window.klaroObserver, 'http-on-modify-request')");
  results.push({ browser: 'firefox', version: firefox.version, scenario: 'production sidebar open + manual typing without login or send', requests, observerVerified: true, passed: true });
} finally { await firefox.close(); }
await mkdir('docs/release', { recursive: true });
await writeFile('docs/release/package-network.json', JSON.stringify({ testedAt: new Date().toISOString(), status: 'passed', limitation: 'Request destinations inspected; placeholder backend is not deployed. Authenticated workflows covered by separate local OIDC/provider-double tests.', results }, null, 2) + '\n');
console.info('Real Chrome, Edge and Firefox production package network destination audit passed');
