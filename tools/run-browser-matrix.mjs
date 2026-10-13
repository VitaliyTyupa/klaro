import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const selected = (process.env.KLARO_MATRIX_BROWSERS ?? 'chrome,edge,firefox').split(',');
assert.ok(selected.length > 0 && selected.every(browser => ['chrome', 'edge', 'firefox'].includes(browser)));

const run = (file, environment) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', file], { env: { ...process.env, ...environment }, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Browser matrix failed: ${file} (${code})`)));
});
for (const browser of ['chrome', 'edge']) {
  if (!selected.includes(browser)) continue;
  await run('tests/correction.e2e.mjs', { KLARO_BROWSER: browser, KLARO_BROWSER_MATRIX: '1', KLARO_MATRIX_PARTIAL: '1', KLARO_PARTIAL_SURFACE: 'panel' });
}
if (selected.includes('chrome')) await run('tests/correction.e2e.mjs', { KLARO_BROWSER: 'chrome', KLARO_BROWSER_MATRIX: '0', KLARO_MATRIX_PARTIAL: '1', KLARO_PARTIAL_SURFACE: 'web' });
if (selected.includes('firefox')) await run('tests/firefox-package.browser.mjs', { KLARO_BROWSER_MATRIX: '1', KLARO_MATRIX_PARTIAL: '1' });
