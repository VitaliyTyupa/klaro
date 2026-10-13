import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const root = resolve('dist/web/browser');
const provenance = { id: 'fixture-provenance', url: 'https://en.wiktionary.org/wiki/Bank', revision: 'fixture-v1', license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: 'Synthetic fixture authors', evidenceUrl: 'https://example.org' };
const candidates = [1, 2].map(number => ({ id: `fixture-${number}`, sourceVersion: 'fixture-version', language: 'de', lemma: 'Bank', partOfSpeech: 'noun', homonymKey: `homonym-${number}` }));
const requests = []; const operations = new Map(); const reports = []; let formsFail = true;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  try {
    let value;
    if (url.pathname === '/v1/privacy/processing') value = { version: 'fixture-disclosure', provider: 'test-double', providerRetention: 'Synthetic fixture only', providerStore: false, backend: { payloadMaximumMinutes: 30, resultMaximumMinutes: 15, digestHours: 24, metadataDays: 30, supplementDays: 7 } };
    else if (url.pathname === '/auth/session') value = { userId: 'synthetic-user' };
    else if (url.pathname === '/v1/me/preferences') value = { version: 'v1', nativeLanguage: 'uk', writingLanguages: ['de'], activeWritingLanguage: 'de', style: 'neutral', proficiency: null };
    else if (url.pathname.startsWith('/v1/reference/')) {
      requests.push(url.pathname + url.search);
      if (url.pathname.endsWith('/supplements')) value = { supplement: null };
      else if (url.pathname.endsWith('/reports')) { let body = ''; for await (const chunk of request) body += chunk; const report = JSON.parse(body); assert.deepEqual(Object.keys(report).sort(), ['reason', 'targetId', 'targetKind']); reports.push(report); value = { received: true }; }
      else if (url.pathname.endsWith('/lookup')) value = { version: 'v1', candidates: url.searchParams.get('query') === 'Bank' ? candidates : [], nextOffset: null };
      else if (url.pathname.endsWith('/sections')) value = { sections: [{ section: 'plural', state: 'available' }, { section: 'examples', state: 'missing' }] };
      else if (url.pathname.endsWith('/sections/plural')) { if (formsFail) { formsFail = false; response.writeHead(503); response.end('{}'); return; } value = { sourceVersion: 'fixture-version', section: 'plural', state: 'available', items: [{ text: 'Bänke', tags: ['plural'], senseId: null, provenance }] }; }
      else if (url.pathname.endsWith('/sections/examples')) value = { sourceVersion: 'fixture-version', section: 'examples', state: 'missing', items: [] };
      else value = { ...candidates[0], features: { tags: ['feminine'] }, provenance, moreSenses: false, unlinkedTranslations: [], senses: [{ id: 'sense-bench', definitions: ['bench <script>window.xssCanary = true</script><img src="https://malicious.test/xss" onerror="window.xssCanary=true">'], definitionLanguage: 'en', provenance, translations: [], examples: [] }] };
    }
    if (value) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); return; }
    if (url.pathname === '/v1/operations' && request.method === 'POST') { let body = ''; for await (const chunk of request) body += chunk; const command = JSON.parse(body); const id = `fixture-operation-${operations.size}`; operations.set(id, command); response.writeHead(202, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ version: 'v1', operationId: id, revisionId: command.revisionId, status: 'accepted', sequence: 0, resourceUrl: `/v1/operations/${id}` })); return; }
    if (url.pathname.startsWith('/v1/operations/')) { const id = url.pathname.split('/').at(-1); const command = operations.get(id); if (!command) throw new Error('Invalid fixture operation'); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ version: 'v1', operationId: id, revisionId: command.revisionId, sequence: 3, status: 'completed', resultVersion: 1, payloadStatus: 'available', results: [{ kind: 'lexical', revisionId: command.revisionId, ...command.lexical, originKind: command.operationType === 'source-translation' ? 'machine-translation' : 'generated-unverified', text: 'Synthetic AI reference output <script>window.xssCanary = true</script><img src="https://malicious.test/ai" onerror="window.xssCanary=true">', warnings: ['unverified-grammar'] }] })); return; }
    const file = extname(url.pathname) ? resolve(root, `.${url.pathname}`) : resolve(root, 'index.html'); if (!file.startsWith(`${root}/`)) throw new Error('Invalid path');
    response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html'); response.end(await readFile(file));
  } catch { response.writeHead(500); response.end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening'); let browser;
try {
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }); const context = await browser.newContext(); const page = await context.newPage(); const external = []; page.on('request', request => { if (request.url().includes('malicious.test')) external.push(request.url()); }); const errors = []; page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`; await page.goto(`${origin}/reference`);
  await page.getByRole('textbox', { name: 'Слово або словоформа' }).fill('Bank'); await page.getByRole('button', { name: 'Знайти', exact: true }).click();
  await page.getByRole('button', { name: 'Bank · noun · homonym-1', exact: true }).click(); await page.getByText('Перекладу основною мовою у джерелі немає.').waitFor();
  assert.equal(requests.some(path => path.includes('/sections/plural')), false);
  const plural = page.locator('summary', { hasText: 'Множина' }); await plural.focus(); await page.keyboard.press('Enter'); await page.getByText('Не вдалося завантажити.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Повторити', exact: true }).click(); await page.getByText('Bänke', { exact: false }).waitFor();
  await plural.click(); await plural.click(); assert.equal(requests.filter(path => path.includes('/sections/plural')).length, 2);
  await page.locator('summary', { hasText: 'Приклади' }).click(); await page.getByText('Даних у джерелі немає.').waitFor();
  assert.equal(operations.size, 0);
  await page.getByRole('button', { name: 'Доповнити за допомогою ШІ', exact: true }).click(); await page.getByRole('heading', { name: 'Передача тексту для обробки' }).waitFor(); assert.equal(operations.size, 0); await page.getByRole('button', { name: 'Підтверджую передачу тексту' }).click(); await page.getByRole('heading', { name: 'Неперевірене доповнення ШІ', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Повідомити про помилку доповнення', exact: true }).click(); await page.getByText('Повідомлення отримано.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Перекласти тлумачення за допомогою ШІ', exact: true }).click(); await page.getByRole('heading', { name: 'Машинний переклад джерела', exact: true }).waitFor(); assert.equal(operations.size, 2);
  await page.getByRole('button', { name: 'Повідомити про помилку джерела', exact: true }).click(); await page.getByText('Повідомлення отримано.', { exact: true }).waitFor(); assert.equal(reports.length, 2);
  assert.equal(await page.evaluate(() => window.xssCanary), undefined); assert.deepEqual(external, []); assert.equal(await page.locator('img[src*="malicious.test"]').count(), 0);
  const accessibility = await new AxeBuilder({ page }).analyze(); assert.deepEqual(accessibility.violations.filter(item => ['critical', 'serious'].includes(item.impact)), []);
  await page.getByRole('link', { name: 'Редактор', exact: true }).click(); const input = page.getByRole('textbox', { name: 'Вхідний текст', exact: true }); await input.fill('Private prefix Bank private suffix');
  await input.evaluate(element => { element.setSelectionRange(15, 19); element.dispatchEvent(new Event('select')); });
  await page.getByRole('button', { name: 'Довідка про виділене слово' }).click(); await page.getByRole('button', { name: 'Bank · noun · homonym-1', exact: true }).waitFor();
  assert.equal(requests.some(path => path.includes('Private') || path.includes('prefix') || path.includes('suffix')), false);
  assert.deepEqual(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)]), [[], []]); assert.deepEqual(errors, []);
  console.info(`Reference lazy sections, keyboard, transport retry, missing translation and explicit selection passed (Chrome ${browser.version()})`);
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
