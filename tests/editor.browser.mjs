import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
const servers = [];
let browser;
async function captureRelease(page, name) {
  if (process.env.KLARO_RELEASE_SCREENSHOTS !== '1') return;
  await mkdir('docs/release/screenshots', { recursive: true });
  const previous = page.viewportSize(); await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/release/screenshots/${name}.png` });
  await page.setViewportSize(previous);
}
async function host(root) {
  const operations = new Map();
  const feedback = [];
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      if (path === '/v1/privacy/processing') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ version: 'fixture-disclosure', provider: 'test-double', providerRetention: 'Synthetic fixture only', providerStore: false, backend: { payloadMaximumMinutes: 30, resultMaximumMinutes: 15, digestHours: 24, metadataDays: 30, supplementDays: 7 } })); return; }
      if (path === '/auth/session') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ userId: 'synthetic-user' })); return; }
      if (path === '/v1/me/preferences') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ version: 'v1', nativeLanguage: 'uk', writingLanguages: ['de'], activeWritingLanguage: 'de', style: 'neutral', proficiency: null })); return; }
      if (path === '/v1/operations' && request.method === 'POST') {
        let body = ''; for await (const chunk of request) body += chunk;
        const command = JSON.parse(body);
        const releaseExample = process.env.KLARO_RELEASE_SCREENSHOTS === '1' && ['Ich habe gestern einen Brief geschickt.', 'Я вчора надіслав лист.'].includes(command.input);
        assert.deepEqual(command.selection, command.input === 'I is here.' || releaseExample ? { scope: 'document' } : { scope: 'selection', start: 7, end: 18 });
        assert.deepEqual(command.protectedSpans, command.input === 'I is here.' || releaseExample || command.operationType === 'translation' ? [] : [{ start: 7, end: 18 }]);
        const operationId = randomUUID();
        operations.set(operationId, command);
        response.writeHead(202, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ version: 'v1', operationId, revisionId: command.revisionId, status: 'accepted', sequence: 0, resourceUrl: `/v1/operations/${operationId}` })); return;
      }
      if (path.endsWith('/feedback') && request.method === 'POST') {
        let body = ''; for await (const chunk of request) body += chunk;
        const value = JSON.parse(body); assert.deepEqual(Object.keys(value), ['reason']);
        assert.ok(operations.has(path.split('/').at(-2))); feedback.push(value);
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ received: true })); return;
      }
      if (path === '/synthetic-feedback-count') { response.end(JSON.stringify(feedback.length)); return; }
      if (path.startsWith('/v1/operations/')) {
        const operationId = path.split('/').at(-1), command = operations.get(operationId);
        if (!command) throw new Error('Unknown operation');
        if (process.env.KLARO_RELEASE_SCREENSHOTS === '1' && command.input === 'Ich habe gestern einen Brief geschickt.') {
          const recommendationId = `${operationId}-recommendation`;
          const primary = { kind: 'correction', language: 'de', revisionId: command.revisionId, recommendationId, text: command.input, editGroups: [], warnings: ['no-changes'] };
          response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ version: 'v1', operationId, revisionId: command.revisionId, status: 'completed', sequence: 3, resultVersion: 2, payloadStatus: 'available', results: [primary, { kind: 'translation', language: 'uk', revisionId: command.revisionId, recommendationId, text: 'Я вчора надіслав лист.', warnings: [] }] })); return;
        }
        if (process.env.KLARO_RELEASE_SCREENSHOTS === '1' && command.operationType === 'translation' && command.input === 'Я вчора надіслав лист.') {
          response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ version: 'v1', operationId, revisionId: command.revisionId, status: 'completed', sequence: 3, resultVersion: 1, payloadStatus: 'available', results: [{ kind: 'translation', language: 'de', revisionId: command.revisionId, text: 'Ich habe gestern einen Brief geschickt.', warnings: [] }] })); return;
        }
        if (command.operationType === 'translation') {
          const text = command.selection.scope === 'selection' ? command.input.slice(command.selection.start, command.selection.end) : command.input;
          response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ version: 'v1', operationId, revisionId: command.revisionId, status: 'completed', sequence: 3, resultVersion: 1, payloadStatus: 'available', results: [{ kind: 'translation', language: command.targetLanguage, revisionId: command.revisionId, text: `Synthetic translated: ${text}`, warnings: ['ambiguous-input', 'language-mismatch'] }] })); return;
        }
        if (command.operationType === 'explanation') {
          response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ version: 'v1', operationId, revisionId: command.revisionId, status: 'completed', sequence: 3, resultVersion: 1, payloadStatus: 'available', results: [{ kind: 'explanation', language: 'uk', revisionId: command.revisionId, recommendationId: command.recommendation.recommendationId, text: `Synthetic explanation: ${command.recommendation.text}`, warnings: [] }] })); return;
        }
        if (command.operationType === 'alternatives') {
          response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ version: 'v1', operationId, revisionId: command.revisionId, status: 'completed', sequence: 3, resultVersion: 1, payloadStatus: 'available', results: [{ kind: 'alternatives', language: 'de', revisionId: command.revisionId, alternatives: [1, 2, 3].map(number => ({ recommendationId: `${operationId}-alternative-${number}`, text: `Synthetic variant ${number}` })), warnings: [] }] })); return;
        }
        if (command.operationType === 'back-translation') {
          response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ version: 'v1', operationId, revisionId: command.revisionId, status: 'completed', sequence: 3, resultVersion: 1, payloadStatus: 'available', results: [{ kind: 'translation', language: 'uk', revisionId: command.revisionId, recommendationId: command.recommendation.recommendationId, text: `Synthetic native: ${command.recommendation.text}`, warnings: [] }] })); return;
        }
        const edits = command.input === 'I is here.';
        const partial = edits && command.operationType === 'correction';
        const recommendationId = `${operationId}-recommendation`;
        const text = edits ? 'I am here.' : command.input.slice(command.selection.start, command.selection.end);
        const primary = { kind: 'correction', language: 'de', revisionId: command.revisionId, recommendationId, text, editGroups: edits ? [{ groupId: 'synthetic-edit', edits: [{ span: { start: 2, end: 4 }, original: 'is', replacement: 'am' }] }] : [], warnings: edits ? [] : ['no-changes'] };
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ version: 'v1', operationId, revisionId: command.revisionId, status: partial ? 'partially-completed' : 'completed', sequence: 5, resultVersion: partial ? 1 : 2, payloadStatus: 'available', results: partial ? [primary] : [primary, { kind: 'translation', language: 'uk', revisionId: command.revisionId, recommendationId, text, warnings: [] }], ...(partial ? { error: { code: 'provider-error', retryable: true } } : {}) })); return;
      }
      const file = extname(path) ? resolve(root, `.${path}`) : resolve(root, 'index.html');
      if (!file.startsWith(`${root}/`)) throw new Error('Invalid path');
      response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html'); response.end(await readFile(file));
    } catch (error) { console.error('Synthetic editor fixture failed:', error.message); response.writeHead(500); response.end(); }
  });
  const sockets = new Server(server, { transports: ['websocket'] }); sockets.of('/v1/operations');
  servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`;
}
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  for (const [surface, maximum] of [['web', 20000], ['extension', 5000]]) {
    const origin = await host(resolve(`dist/${surface}/browser`));
    const context = await browser.newContext({ viewport: surface === 'web' ? { width: 1500, height: 1000 } : { width: 480, height: 1000 } });
    const page = await context.newPage();
    await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.syntheticClipboard = text; } } }); });
    const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('Synthetic page error:', error.message); });
    await page.goto(origin);
    const input = page.getByRole('textbox', { name: 'Вхідний текст', exact: true });
    await input.fill('😀'.repeat(maximum));
    await page.getByText(`Символи: ${maximum} / ${maximum}`, { exact: true }).waitFor();
    assert.equal(await input.getAttribute('aria-invalid'), 'false');
    await input.fill('😀'.repeat(maximum + 1));
    await page.getByText(`Символи: ${maximum + 1} / ${maximum}`, { exact: true }).waitFor();
    assert.equal(await input.getAttribute('aria-invalid'), 'true'); assert.equal(Array.from(await input.inputValue()).length, maximum + 1);
    await page.getByText('Текст перевищує ліміт. Скоротіть його перед надсиланням; ввід збережено повністю.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox').count(), 3);
    assert.equal(await page.getByRole('textbox', { name: 'Рекомендація', exact: true }).evaluate(element => element.readOnly), true);
    await page.getByRole('button', { name: 'Перекладач', exact: true }).click();
    await page.getByRole('textbox', { name: 'Переклад рекомендації основною мовою', exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('textbox').count(), 2);
    await page.getByRole('button', { name: 'Корекція', exact: true }).click();
    await page.getByRole('textbox', { name: 'Переклад рекомендації основною мовою', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox').count(), 3);
    await input.fill('Synthetic editor 😀');
    await page.screenshot({ path: `/tmp/klaro-editor-${surface}.png`, fullPage: true });
    await input.fill('Prefix 😀 selected suffix');
    await input.evaluate(element => { element.setSelectionRange(7, 18); element.dispatchEvent(new Event('select', { bubbles: true })); });
    await page.getByText(/Виділено символів: 10\./).waitFor();
    await page.getByRole('button', { name: 'Захистити виділену фразу', exact: true }).click();
    await page.getByText('Захищені фрази цієї чернетки:', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Корекція', exact: true }).focus();
    await page.getByText(/Виділено символів: 10\./).waitFor();
    if (surface === 'web') {
      const run = page.getByRole('button', { name: 'Опрацювати', exact: true });
      for (let index = 0; index < 20 && !(await run.evaluate(element => element === document.activeElement)); index++) await page.keyboard.press('Tab');
      assert.equal(await run.evaluate(element => element === document.activeElement), true);
      assert.equal(await run.evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Підтверджую передачу тексту' }).click();
      try { await page.waitForFunction(() => document.querySelectorAll('textarea')[1]?.value === '😀 selected', undefined, { timeout: 5000 }); }
      catch (error) { console.error('Synthetic run state:', await page.locator('body').innerText()); throw error; }
      assert.equal(await page.getByRole('textbox', { name: 'Переклад рекомендації основною мовою', exact: true }).inputValue(), '😀 selected');
      assert.equal(await input.inputValue(), 'Prefix 😀 selected suffix');
      assert.equal(await run.evaluate(element => element === document.activeElement), true);
      await page.getByText('Результат готовий. Вхідний текст залишено без змін.', { exact: true }).waitFor();
      assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) })), []);
      assert.equal(await (await fetch(`${origin}/synthetic-feedback-count`)).json(), 0);
      await page.getByRole('combobox', { name: 'Причина проблеми', exact: true }).click();
      await page.getByRole('option', { name: 'Неправильна граматика', exact: true }).click();
      await page.getByRole('button', { name: 'Повідомити про проблему', exact: true }).click();
      await page.getByText('Дякуємо за оцінку.', { exact: true }).waitFor();
      assert.equal(await (await fetch(`${origin}/synthetic-feedback-count`)).json(), 1);
      assert.equal(await page.getByRole('button', { name: 'Копіювати результат', exact: true }).count(), 1);
      await page.getByRole('button', { name: 'Копіювати результат', exact: true }).click();
      await page.getByText('Основний результат скопійовано.', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.syntheticClipboard), '😀 selected');
      await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Synthetic clipboard permission denied'); } } }); });
      await page.getByRole('button', { name: 'Копіювати результат', exact: true }).click();
      await page.getByText('Результат виділено. Натисніть Ctrl+C або ⌘C, щоб скопіювати вручну.', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.value), '😀 selected');
      await input.fill('Changed draft');
      assert.equal(await page.getByRole('button', { name: 'Повідомити про проблему', exact: true }).count(), 0);
      await page.getByRole('combobox', { name: 'Попередні оригінали цього сеансу', exact: true }).click();
      await page.getByRole('option', { name: 'Prefix 😀 selected suffix', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('textarea')?.value === 'Prefix 😀 selected suffix');
      assert.equal(await input.inputValue(), 'Prefix 😀 selected suffix');
      assert.equal(await page.getByRole('button', { name: 'Копіювати результат', exact: true }).isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)]), [[], []]);
      await page.getByRole('button', { name: 'Очистити', exact: true }).click();
      await page.getByRole('combobox', { name: 'Попередні оригінали цього сеансу', exact: true }).waitFor({ state: 'detached' });
      assert.equal(await input.inputValue(), '');
      await input.fill('I is here.');
      for (let index = 0; index < 30 && !(await run.evaluate(element => element === document.activeElement)); index++) await page.keyboard.press('Tab');
      assert.equal(await run.evaluate(element => element === document.activeElement), true); await page.keyboard.press('Enter');
      const edits = page.getByRole('region', { name: 'Правки', exact: true }); await edits.waitFor();
      assert.equal(await edits.locator('del').innerText(), 'is'); assert.equal(await edits.locator('ins').innerText(), 'am');
      assert.match(await edits.innerText(), /Було: is → Стало: am/);
      const copy = page.getByRole('button', { name: 'Копіювати результат', exact: true }); assert.equal(await copy.isDisabled(), false);
      await page.getByText('Не вдалося перекласти рекомендацію. Основний результат доступний.', { exact: true }).waitFor();
      const activateKeyboard = async button => { for (let index = 0; index < 35 && !(await button.evaluate(element => element === document.activeElement)); index++) await page.keyboard.press('Tab'); assert.equal(await button.evaluate(element => element === document.activeElement), true); await page.keyboard.press('Enter'); };
      await activateKeyboard(page.getByRole('button', { name: 'Повторити лише переклад рекомендації', exact: true }));
      const native = page.getByRole('textbox', { name: 'Переклад рекомендації основною мовою', exact: true });
      await page.waitForFunction(() => document.querySelectorAll('textarea')[2]?.value === 'Synthetic native: I am here.');
      await activateKeyboard(edits.getByRole('button', { name: 'Відхилити правку', exact: true }));
      await page.waitForFunction(() => document.querySelectorAll('textarea')[1]?.value === 'I is here.' && document.querySelectorAll('textarea')[2]?.value === 'Synthetic native: I is here.');
      assert.equal(await input.inputValue(), 'I is here.');
      await activateKeyboard(edits.getByRole('button', { name: 'Прийняти правку', exact: true }));
      await page.waitForFunction(() => document.querySelectorAll('textarea')[1]?.value === 'I am here.' && document.querySelectorAll('textarea')[2]?.value === 'Synthetic native: I am here.');
      assert.equal(await native.inputValue(), 'Synthetic native: I am here.');
      assert.equal(await copy.count(), 1);
      await activateKeyboard(page.getByRole('button', { name: 'Ще варіанти', exact: true }));
      const alternatives = page.getByRole('button', { name: 'Ще варіанти', exact: true });
      await page.waitForFunction(() => document.querySelectorAll('textarea')[1]?.value === 'Synthetic variant 1' && document.querySelectorAll('textarea')[2]?.value === 'Synthetic native: Synthetic variant 1');
      await activateKeyboard(alternatives);
      await page.waitForFunction(() => document.querySelectorAll('textarea')[1]?.value === 'Synthetic variant 2' && document.querySelectorAll('textarea')[2]?.value === 'Synthetic native: Synthetic variant 2');
      await activateKeyboard(alternatives);
      await page.waitForFunction(() => document.querySelectorAll('textarea')[2]?.value === 'Synthetic native: Synthetic variant 3');
      assert.equal(await alternatives.isDisabled(), true);
      await activateKeyboard(page.getByRole('button', { name: 'Перефразувати явно', exact: true }));
      await page.waitForFunction(() => document.querySelectorAll('textarea')[1]?.value === 'I am here.' && document.querySelectorAll('textarea')[2]?.value === 'I am here.');
      assert.equal(await input.inputValue(), 'I is here.');
      await activateKeyboard(page.getByRole('button', { name: 'Пояснити покращення', exact: true }));
      const explanation = page.getByRole('region', { name: 'Пояснення основною мовою', exact: true }); await explanation.waitFor();
      assert.match(await explanation.innerText(), /Synthetic explanation: I am here\./);
      assert.equal(await page.getByRole('textbox', { name: 'Рекомендація', exact: true }).inputValue(), 'I am here.');
      await activateKeyboard(page.getByRole('button', { name: 'Відхилити правку', exact: true }));
      await explanation.getByText('Пояснення неактуальне після зміни рекомендації або input.', { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('textarea')[2]?.value === 'Synthetic native: I is here.');
    }
    if (surface === 'web') {
      const commands = []; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/v1/operations')) commands.push(request.postDataJSON()); });
      await page.getByRole('button', { name: 'Перекладач', exact: true }).click();
      await page.getByRole('textbox', { name: 'Переклад', exact: true }).waitFor();
      assert.equal(await page.getByRole('textbox').count(), 2);
      await input.fill('Prefix 😀 selected suffix');
      await input.evaluate(element => { element.setSelectionRange(7, 18); element.dispatchEvent(new Event('select', { bubbles: true })); });
      await page.getByRole('button', { name: 'Опрацювати', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('textarea')[1]?.value === 'Synthetic translated: 😀 selected');
      await page.getByText('Мова вводу може не відповідати обраному напрямку. Перевірте текст і мови перекладу.', { exact: true }).waitFor();
      assert.equal(commands.length, 1); assert.equal(commands[0].operationType, 'translation'); assert.equal(commands[0].sourceLanguage, 'uk'); assert.equal(commands[0].targetLanguage, 'de');
      await page.getByRole('button', { name: 'Змінити напрямок', exact: true }).click();
      await page.getByText('Німецька → Українська', { exact: true }).waitFor();
      await page.getByText('Результат неактуальний після зміни тексту або налаштувань.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Копіювати результат', exact: true }).isDisabled(), true);
      await page.getByRole('button', { name: 'Опрацювати', exact: true }).click();
      await page.getByText('Результат готовий. Вхідний текст залишено без змін.', { exact: true }).waitFor();
      assert.equal(commands.length, 2); assert.equal(commands[1].sourceLanguage, 'de'); assert.equal(commands[1].targetLanguage, 'uk'); assert.deepEqual(commands[1].preferences, commands[0].preferences);
      assert.equal(await input.inputValue(), 'Prefix 😀 selected suffix'); assert.equal(await page.getByRole('textbox').count(), 2);
      if (process.env.KLARO_RELEASE_SCREENSHOTS === '1') {
        await page.getByRole('button', { name: 'Очистити', exact: true }).click();
        await page.getByRole('button', { name: 'Корекція', exact: true }).click();
        await input.fill('Ich habe gestern einen Brief geschickt.');
        await page.getByRole('button', { name: 'Опрацювати', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('textarea')[2]?.value === 'Я вчора надіслав лист.');
        await captureRelease(page, 'correction-web');
        await page.getByRole('button', { name: 'Очистити', exact: true }).click();
        await page.getByRole('button', { name: 'Перекладач', exact: true }).click();
        await page.getByRole('button', { name: 'Змінити напрямок', exact: true }).click();
        await input.fill('Я вчора надіслав лист.');
        await page.getByRole('button', { name: 'Опрацювати', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('textarea')[1]?.value === 'Ich habe gestern einen Brief geschickt.');
        await captureRelease(page, 'translation-web');
      }
    }
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) })), []);
    assert.deepEqual(errors, []); await context.close();
  }
  console.info(`Shared web/panel layout, Unicode limits and no paste truncation passed (Chrome ${browser.version()})`);
} finally { await browser?.close(); for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
