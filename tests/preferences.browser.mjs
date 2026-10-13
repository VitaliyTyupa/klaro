import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

let preferences = { version: 'v1', nativeLanguage: 'uk', writingLanguages: ['de'], activeWritingLanguage: 'de', style: 'neutral', proficiency: null };
const root = resolve('dist/web/browser');
const userId = '11111111-1111-4111-8111-111111111111';
const csrf = 'c'.repeat(43);
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/auth/session') {
      response.setHeader('Set-Cookie', `klaro_csrf=${csrf}; Path=/; SameSite=Lax`);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ userId }));
      return;
    }
    if (url.pathname === '/v1/me/preferences') {
      if (request.method === 'PUT') {
        assert.equal(request.headers['x-csrf-token'], csrf);
        let body = '';
        for await (const chunk of request) body += chunk;
        preferences = JSON.parse(body);
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(preferences));
      return;
    }
    if (url.pathname === '/v1/me/usage') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ version: 'v1', day: '2026-10-09', operations: 5, providerAttempts: 8, actual: { inputTokens: 56, outputTokens: 56, costMicrousd: 0 }, estimated: { inputTokens: 0, outputTokens: 0, costMicrousd: 0 }, heldTokens: 0, heldCostMicrousd: 0 }));
      return;
    }
    const file = extname(url.pathname) ? resolve(root, `.${url.pathname}`) : resolve(root, 'index.html');
    if (!file.startsWith(`${root}/`)) throw new Error('Invalid asset path');
    const content = await readFile(file);
    response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html');
    response.end(content);
  } catch { response.writeHead(500); response.end('Test request failed'); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}/settings`);
  await page.getByRole('combobox', { name: 'Мови письма', exact: true }).click();
  await page.getByRole('option', { name: 'Англійська', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'Мова письма', exact: true }).click();
  await page.getByRole('option', { name: 'Англійська', exact: true }).click();
  await page.getByRole('combobox', { name: 'Стиль', exact: true }).click();
  await page.getByRole('option', { name: 'Офіційний', exact: true }).click();
  await page.getByRole('combobox', { name: 'Рівень володіння', exact: true }).click();
  await page.getByRole('option', { name: 'B2', exact: true }).click();
  await page.getByRole('button', { name: 'Зберегти', exact: true }).click();
  await page.getByText('Налаштування збережено.', { exact: true }).waitFor();
  assert.equal(preferences.activeWritingLanguage, 'en');
  assert.equal(preferences.style, 'formal');
  assert.equal(preferences.proficiency, 'B2');
  await page.reload();
  await page.getByRole('combobox', { name: 'Мова письма', exact: true }).getByText('Англійська', { exact: true }).waitFor();
  await page.screenshot({ path: '/tmp/klaro-settings.png', fullPage: true });
  await page.getByRole('link', { name: 'Профіль', exact: true }).click();
  await page.getByText(`Ідентифікатор акаунта: ${userId}`, { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Використання за день (UTC)', exact: true }).waitFor();
  await page.getByText('56 / 56', { exact: true }).waitFor();
  assert.equal(await page.locator('dd').nth(0).textContent(), '5');
  assert.equal(await page.locator('dd').nth(1).textContent(), '8');
  await page.screenshot({ path: '/tmp/klaro-usage.png', fullPage: true });
  await page.getByRole('link', { name: 'Редактор', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Вхідний текст', exact: true });
  await input.fill('Synthetic draft with 😀');
  await page.getByRole('combobox', { name: 'Мова письма', exact: true }).click();
  await page.getByRole('option', { name: 'Німецька', exact: true }).click();
  await page.getByText('Налаштування збережено.', { exact: true }).waitFor();
  assert.equal(await input.inputValue(), 'Synthetic draft with 😀');
  assert.equal(preferences.activeWritingLanguage, 'de');
  assert.deepEqual(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)]), [[], []]);
  assert.deepEqual(errors, []);
  console.info(`Preferences browser save/reload, profile and draft-preserving selector passed (Chrome ${browser.version()})`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
