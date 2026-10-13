import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { launchFirefox } from './firefox.fixture.mjs';
import { spawn, execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createClient } from 'redis';
import { startOidcProvider } from './oidc-provider.fixture.mjs';
import { runBrowserMatrix } from './browser-matrix.fixture.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const until = async (predicate, name) => { for (let index = 0; index < 200; index++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error(`Timed out: ${name}`); };
const database = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro' }); await database.connect();
const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6380' }); await redis.connect();
const provider = await startOidcProvider(); const subject = `synthetic-firefox-${randomUUID()}`; provider.setSubject(subject);
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const partial = process.env.KLARO_MATRIX_PARTIAL === '1';
let firefox; let child; let logs = '';
try {
  execFileSync(process.execPath, ['tools/package-extension.mjs', '--browser=firefox', '--development', `--origin=${origin}`], { stdio: 'inherit' });
  firefox = await launchFirefox();
  const id = await firefox.command('POST', '/moz/addon/install', { path: resolve('dist/packages/firefox-development'), temporary: true });
  assert.equal(id, 'klaro@klaro.local');
  await firefox.context('chrome');
  await until(() => firefox.evaluate('return document.getElementById("sidebar").contentDocument?.getElementById("webext-panels-browser")?.browsingContext?.currentWindowGlobal?.documentURI?.spec.startsWith("moz-extension:")'), 'native sidebar ready');
  await until(() => firefox.panel(() => Boolean(document.querySelector('textarea'))), 'Angular sidebar ready');
  const callback = await firefox.panel(() => browser.identity.getRedirectURL('klaro'));
  const extensionOrigin = await firefox.panel(() => location.origin);
  child = spawn(process.execPath, ['dist/api/main.js'], { env: { ...process.env, NODE_ENV: 'test', PORT: String(port), APP_ORIGIN: origin, OIDC_ISSUER: provider.issuer, OIDC_CLIENT_ID: 'klaro-test', OIDC_ALLOW_LOOPBACK_HTTP: 'true', EXTENSION_CALLBACKS: callback, EXTENSION_ORIGINS: extensionOrigin, AI_PROVIDER: 'double', AI_DOUBLE_NATIVE_INCOMPLETE_ONCE: partial ? 'true' : 'false', OPERATION_HMAC_KEY: randomBytes(32).toString('hex') }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
  await until(async () => { if (child.exitCode !== null) throw new Error('API bootstrap failed'); try { return (await fetch(`${origin}/health`)).ok; } catch { return false; } }, 'API ready');
  for (const candidate of [extensionOrigin, 'moz-extension://unrelated-synthetic']) {
    const response = await fetch(`${origin}/auth/extension/exchange`, { method: 'OPTIONS', headers: { Origin: candidate, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Content-Type' } });
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), candidate === extensionOrigin ? extensionOrigin : null);
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
  }
  const click = async name => {
    await until(() => firefox.panel(name => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === name && !button.disabled), [name]), `enabled button: ${name}`);
    assert.equal(await firefox.clickPanel(name), true);
  };
  await click('Увійти');
  await until(() => firefox.panel(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Вийти')), 'native identity login');
  assert.equal(provider.exchanges(), 1);
  const user = (await database.query('SELECT user_id FROM klaro.external_identities WHERE issuer = $1 AND subject = $2', [provider.issuer, subject])).rows[0].user_id;
  const original = 'Synthetic Firefox correction 😀 ABC-123';
  await firefox.panel(() => { const input = document.querySelector('textarea'); input.value = '😀'.repeat(5001); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await until(() => firefox.panel(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Опрацювати').disabled), 'panel input limit');
  assert.equal(await firefox.panel(() => Array.from(document.querySelector('textarea').value).length), 5001);
  await firefox.panel(text => { const input = document.querySelector('textarea'); input.focus(); input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); }, [original]);
  await click('Опрацювати');
  await until(() => firefox.panel(() => document.body.innerText.includes('Передача тексту для обробки')), 'first-send disclosure');
  assert.equal(Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE user_id = $1', [user])).rows[0].count), 0);
  await click('Підтверджую передачу тексту');
  if (partial) {
    await until(() => firefox.panel(() => document.body.innerText.includes('Не вдалося перекласти рекомендацію. Основний результат доступний.')), 'partial native failure');
    assert.equal(await firefox.panel(() => document.querySelectorAll('textarea')[1].value), original);
    await click('Повторити лише переклад рекомендації');
  }
  await until(() => firefox.panel(text => document.querySelectorAll('textarea')[1]?.value === text && document.querySelectorAll('textarea')[2]?.value === text, [original]), 'correction and native rendering');
  assert.equal(await firefox.panel(() => document.querySelector('textarea').value), original);
  assert.equal(Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE user_id = $1', [user])).rows[0].count), partial ? 3 : 2);
  await click('Корисний результат');
  await until(() => firefox.panel(() => document.body.innerText.includes('Дякуємо за оцінку.')), 'voluntary metadata feedback');
  assert.equal(Number((await database.query('SELECT count(*) FROM klaro.operation_feedback WHERE user_id = $1', [user])).rows[0].count), 1);
  assert.equal(Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE user_id = $1', [user])).rows[0].count), partial ? 3 : 2);
  await click('Копіювати результат');
  await until(() => firefox.panel(() => document.body.innerText.includes('Основний результат скопійовано.')), 'native clipboard write');
  assert.deepEqual(await firefox.panel(() => [Object.keys(localStorage), Object.keys(sessionStorage)]), [[], []]);
  await click('Перекладач');
  await until(() => firefox.panel(() => document.querySelectorAll('textarea').length === 2), 'two-area translator');
  await click('Змінити напрямок');
  await until(() => firefox.panel(() => document.body.innerText.includes('Німецька → Українська')), 'reverse direction');
  await firefox.panel(() => { const input = document.querySelector('textarea'); input.value = 'Synthetic selection 3 suffix'; input.dispatchEvent(new Event('input', { bubbles: true })); input.setSelectionRange(10, 21); input.dispatchEvent(new Event('select', { bubbles: true })); });
  await click('Опрацювати');
  await until(() => firefox.panel(() => document.querySelectorAll('textarea')[1]?.value === 'selection 3'), 'selection translation');
  assert.equal(Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE user_id = $1', [user])).rows[0].count), partial ? 4 : 3);
  const profile = (await database.query('SELECT native_language, active_writing_language FROM klaro.user_preferences WHERE user_id = $1', [user])).rows[0]; assert.deepEqual(profile, { native_language: 'uk', active_writing_language: 'de' });
  await click('Копіювати результат'); await until(() => firefox.panel(() => document.body.innerText.includes('Основний результат скопійовано.')), 'translation clipboard');
  await click('Змінити напрямок');
  await until(() => firefox.panel(() => document.body.innerText.includes('Результат неактуальний після зміни тексту або налаштувань.')), 'stale translation');
  await click('Вийти');
  assert.equal(await firefox.panel(() => document.querySelector('textarea').value), '');
  await until(async () => Number((await database.query('SELECT count(*) FROM klaro.sessions WHERE user_id = $1 AND revoked_at IS NULL', [user])).rows[0].count) === 0, 'server session revocation');
  await click('Увійти');
  await until(() => firefox.panel(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Вийти')), 'second login');
  await firefox.panel(() => { const input = document.querySelector('textarea'); input.value = 'Synthetic close draft'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('Автоматично після паузи');
  const previous = await firefox.evaluate('return document.getElementById("sidebar").contentDocument.getElementById("webext-panels-browser").browsingContext.id');
  await firefox.evaluate('SidebarController.hide();');
  await firefox.evaluate('CustomizableUI.addWidgetToArea("klaro_klaro_local-browser-action", "nav-bar");');
  const action = await firefox.command('POST', '/element', { using: 'css selector', value: '#klaro_klaro_local-BAP' });
  await firefox.command('POST', `/element/${action['element-6066-11e4-a52e-4f735466cecf']}/click`, {});
  await until(() => firefox.panel(() => Boolean(document.querySelector('textarea'))), 'action opened sidebar');
  const reopened = await firefox.evaluate('return document.getElementById("sidebar").contentDocument.getElementById("webext-panels-browser").browsingContext.id'); assert.notEqual(reopened, previous);
  assert.equal(await firefox.panel(() => document.querySelector('textarea').value), '');
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal(Number((await database.query('SELECT count(*) FROM klaro.operations WHERE user_id = $1', [user])).rows[0].count), partial ? 3 : 2);
  if (process.env.KLARO_BROWSER_HEADED === '1') {
    await firefox.evaluate('SidebarController.hide();');
    const run = promisify(execFile); const { stdout } = await run('xdotool', ['search', '--onlyvisible', '--name', 'Firefox']); const windowId = stdout.trim().split('\n')[0];
    await run('xdotool', ['windowfocus', '--sync', windowId]); await run('xdotool', ['key', '--clearmodifiers', 'alt+shift+k']);
    await until(() => firefox.evaluate('return SidebarController.isOpen && SidebarController.currentID === "klaro_klaro_local-sidebar-action"'), 'native shortcut');
  } else console.info('Native Firefox hotkey gate pending: use KLARO_BROWSER_HEADED=1 xvfb-run -a npm run test:firefox-package');
  assert.ok(!logs.includes(original));
  console.info(`Firefox ${firefox.version}: native sidebar, identity/OIDC, correction, clipboard, logout and close/reopen passed`);
  if (partial) {
    await mkdir('docs/evaluations/browser-matrix', { recursive: true });
    await writeFile('docs/evaluations/browser-matrix/firefox-panel-partial.json', `${JSON.stringify({ testedAt: new Date().toISOString(), browser: 'firefox', version: firefox.version, provider: 'double', partialSurface: 'panel', recommendationPreserved: true, nativeOnlyRetry: true, attempts: 4, copy: true, logout: true, closeReopen: true, nativeShortcut: process.env.KLARO_BROWSER_HEADED === '1' }, null, 2)}\n`);
  }
  if (process.env.KLARO_BROWSER_MATRIX === '1') {
    await until(() => firefox.panel(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Увійти' && !button.disabled)), 'matrix sidebar bootstrapped');
    await runBrowserMatrix({ evaluate: (fn, value) => firefox.panel(fn, [value]), click, login: async () => {
      await click('Увійти');
      await until(() => firefox.panel(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Вийти')), 'matrix login');
    }, database, databaseUrl: process.env.DATABASE_URL ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro', redis, provider, surface: 'panel', browser: 'firefox', version: firefox.version });
  }
} finally {
  await firefox?.close(); if (child) { child.kill(); if (child.exitCode === null) await once(child, 'exit'); }
  const users = (await database.query('SELECT user_id FROM klaro.external_identities WHERE issuer = $1 AND subject = $2', [provider.issuer, subject])).rows;
  for (const { user_id: user } of users) { const keys = await redis.keys(`klaro:payload:${user}:*`); if (keys.length) await redis.del(keys); await database.query('DELETE FROM klaro.users WHERE id = $1', [user]); }
  await provider.close(); await redis.close(); await database.end();
}
