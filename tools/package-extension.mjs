import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const args = process.argv.slice(2);
const originArgument = args.find(value => value.startsWith('--origin='));
const development = args.includes('--development');
const browser = args.find(value => value.startsWith('--browser='))?.slice('--browser='.length) ?? 'chrome';
assert.ok(['chrome', 'edge', 'firefox'].includes(browser), 'Unsupported browser package');
const origin = new URL(originArgument?.slice('--origin='.length) ?? 'https://klaro.example');
assert.ok(!origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === '/');
assert.ok(origin.protocol === 'https:' || (development && origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)));
const target = resolve(`dist/packages/${browser}${development ? '-development' : ''}`);
// This fixed build-output directory is regenerated; avoid shipping stale hashed bundles.
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp('dist/extension/browser', target, { recursive: true });
await cp('dist/extension/3rdpartylicenses.txt', resolve(target, '3rdpartylicenses.txt'));
await cp(`apps/extension/browser/${browser === 'firefox' ? 'firefox-background.js' : 'service-worker.js'}`, resolve(target, browser === 'firefox' ? 'firefox-background.js' : 'service-worker.js'));
await writeFile(resolve(target, 'backend-config.js'), `// Packaged browser and backend origin.\nglobalThis.KLARO_BROWSER = ${JSON.stringify(browser)};\nglobalThis.KLARO_BACKEND_ORIGIN = ${JSON.stringify(origin.origin)};\n`);
const socketOrigin = origin.origin.replace(/^http/, 'ws');
const manifest = { manifest_version: 3, name: 'Klaro', version: '0.1.0', minimum_chrome_version: '116', description: 'Корекція та переклад тексту, який ви вводите або вставляєте вручну.', permissions: ['sidePanel', 'identity'], host_permissions: [`${origin.origin}/*`], action: { default_title: 'Відкрити Klaro' }, side_panel: { default_path: 'index.html' }, background: { service_worker: 'service-worker.js' }, commands: { 'open-klaro': { suggested_key: { default: browser === 'edge' ? 'Alt+Shift+K' : 'Ctrl+Shift+K', mac: browser === 'edge' ? 'Alt+Shift+K' : 'Command+Shift+K' }, description: 'Відкрити панель Klaro' } }, content_security_policy: { extension_pages: `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ${origin.origin} ${socketOrigin};` } };
assert.ok(!('content_scripts' in manifest));
if (browser === 'firefox') {
  delete manifest.minimum_chrome_version;
  delete manifest.side_panel;
  manifest.permissions = ['identity'];
  manifest.sidebar_action = { default_title: 'Klaro', default_panel: 'index.html' };
  manifest.background = { scripts: ['firefox-background.js'] };
  manifest.browser_specific_settings = { gecko: { id: 'klaro@klaro.local', strict_min_version: '140.0', data_collection_permissions: { required: ['authenticationInfo', 'personalCommunications', 'personallyIdentifyingInfo'] } } };
  manifest.commands['open-klaro'].suggested_key = { default: 'Alt+Shift+K', mac: 'Alt+Shift+K' };
}
for (const file of await readdir(target)) {
  if (extname(file) === '.js') { const source = await readFile(resolve(target, file), 'utf8'); assert.ok(!/\beval\s*\(|new\s+Function\s*\(/.test(source), `Executable string in ${file}`); }
}
const index = await readFile(resolve(target, 'index.html'), 'utf8');
assert.ok(!/<script[^>]+src=["']https?:/i.test(index));
assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>\s*[^<\s]/i.test(index));
await writeFile(resolve(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.info(`${browser} package prepared: ${target} (${origin.origin})`);
