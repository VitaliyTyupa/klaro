import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile, mkdtemp } from 'node:fs/promises';
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const browserKind = process.env.KLARO_BROWSER ?? 'chrome';
assert.ok(['chrome', 'edge'].includes(browserKind));
const executablePath = browserKind === 'edge' ? process.env.EDGE_EXECUTABLE_PATH ?? '/usr/bin/microsoft-edge' : process.env.CHROME_EXECUTABLE_PATH ?? '/usr/bin/google-chrome';
const headed = process.env.KLARO_BROWSER_HEADED === '1' || process.env.KLARO_CHROME_HEADED === '1';
const root = resolve(`dist/packages/${browserKind}`);
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
assert.deepEqual(manifest.permissions, ['sidePanel', 'identity']);
assert.equal(manifest.content_scripts, undefined);
assert.equal(manifest.side_panel.default_path, 'index.html');
assert.deepEqual(manifest.host_permissions, ['https://klaro.example/*']);
let browser;
let context;
try {
  context = await chromium.launchPersistentContext(await mkdtemp(`/tmp/klaro-${browserKind}-package-`), { executablePath, headless: !headed, ignoreDefaultArgs: ['--disable-extensions'], args: ['--no-sandbox', '--enable-unsafe-extension-debugging', ...(headed ? ['--ozone-platform=x11'] : [])] });
  browser = context.browser();
  const cdp = await browser.newBrowserCDPSession();
  const loaded = await cdp.send('Extensions.loadUnpacked', { path: root });
  assert.match(loaded.id, /^[a-p]{32}$/);
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${loaded.id}/index.html`);
  await page.getByRole('button', { name: 'Увійти', exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Вхідний текст', exact: true }).fill('Synthetic packaged panel 😀');
  await page.getByText('Символи: 26 / 5000', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => chrome.runtime.getManifest().manifest_version), 3);
  assert.equal(await page.evaluate(() => typeof chrome.identity.getRedirectURL), 'function');
  assert.equal(await page.evaluate(() => chrome.runtime.getManifest().permissions.includes('tabs')), false);
  assert.deepEqual(errors, []);
  assert.equal((await page.evaluate(() => chrome.sidePanel.getPanelBehavior())).openPanelOnActionClick, true);
  assert.ok((await page.evaluate(() => chrome.commands.getAll())).some(command => command.name === 'open-klaro' && command.shortcut));
  const pageCdp = await context.newCDPSession(page); const { targetInfo: pageTarget } = await pageCdp.send('Target.getTargetInfo');
  const nativePanels = async () => (await cdp.send('Target.getTargets')).targetInfos.filter(value => value.type === 'page' && value.targetId !== pageTarget.targetId && value.url === page.url());
  const waitPanelCount = async count => { for (let index = 0; index < 150; index++) { if ((await nativePanels()).length === count) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error(`Native panel count did not reach ${count}`); };
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }, { exclude: true }] });
  const tabTarget = targetInfos.find(target => target.type === 'tab' && target.url === page.url());
  assert.ok(tabTarget, JSON.stringify(targetInfos));
  await cdp.send('Extensions.triggerAction', { id: loaded.id, targetId: tabTarget.targetId });
  await waitPanelCount(1);
  await page.evaluate(async () => { const current = await chrome.windows.getCurrent(); await chrome.sidePanel.close({ windowId: current.id }); });
  await waitPanelCount(0);
  if (headed) {
    const worker = context.serviceWorkers().find(worker => worker.url().startsWith(`chrome-extension://${loaded.id}/`));
    assert.ok(worker);
    await worker.evaluate(() => {
      chrome.commands.onCommand.addListener((command, tab) => { globalThis.syntheticCommand = { command, windowId: tab?.windowId }; });
      const open = chrome.sidePanel.open.bind(chrome.sidePanel);
      chrome.sidePanel.open = options => open(options).catch(error => { globalThis.syntheticOpenError = error.message; throw error; });
    });
    const fixture = await context.newPage();
    await fixture.goto('data:text/html,<title>Klaro shortcut fixture</title><p>Synthetic manual shortcut fixture</p>');
    await fixture.bringToFront();
    const run = promisify(execFile);
    const { stdout } = await run('xdotool', ['search', '--onlyvisible', '--name', 'Klaro'], { timeout: 5000 });
    const windowId = stdout.trim().split('\n')[0];
    assert.match(windowId, /^\d+$/);
    await run('xdotool', ['windowfocus', '--sync', windowId], { timeout: 5000 });
    await run('xdotool', ['key', '--clearmodifiers', browserKind === 'edge' ? 'alt+shift+k' : 'ctrl+shift+k'], { timeout: 5000 });
    try { await waitPanelCount(1); }
    catch (error) { console.info(await worker.evaluate(() => ({ command: globalThis.syntheticCommand, error: globalThis.syntheticOpenError }))); throw error; }
  } else {
    console.info(`Native hotkey gate pending: run KLARO_BROWSER_HEADED=1 xvfb-run -a npm run test:${browserKind}-package with xdotool installed`);
  }
  await page.screenshot({ path: `/tmp/klaro-${browserKind}-package.png`, fullPage: true });
  const info = await cdp.send('Extensions.getExtensions');
  assert.ok(JSON.stringify(info).includes(loaded.id));
  console.info(`${browserKind} MV3 package loaded with AOT/CSP and manual editor (${browser.version()}, ${loaded.id})`);
} finally { await context?.close(); }
