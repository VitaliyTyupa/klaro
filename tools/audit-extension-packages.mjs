import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

async function files(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await files(root, path)); else result.push(path);
  }
  return result.sort();
}
const results = [];
for (const browser of ['chrome', 'edge', 'firefox']) {
  const root = `dist/packages/${browser}`; const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok((await readFile(`${root}/3rdpartylicenses.txt`, 'utf8')).trim().length > 0, 'Packaged dependency notices required');
  assert.deepEqual(manifest.permissions, browser === 'firefox' ? ['identity'] : ['sidePanel', 'identity']);
  for (const field of ['content_scripts', 'optional_permissions', 'externally_connectable', 'web_accessible_resources']) assert.equal(manifest[field], undefined);
  assert.equal(manifest.host_permissions.length, 1);
  const origin = new URL(manifest.host_permissions[0].slice(0, -2)); assert.equal(origin.protocol, 'https:');
  const csp = manifest.content_security_policy.extension_pages;
  assert.ok(csp.includes("script-src 'self';") && csp.includes("object-src 'none';"));
  assert.ok(!csp.includes('unsafe-eval') && !csp.includes('http:'));
  const hashes = []; let codeFiles = 0;
  for (const path of await files(root)) {
    const bytes = await readFile(join(root, path)); const source = bytes.toString('utf8');
    hashes.push({ path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
    assert.ok(!/\.(map|pem|key)$/.test(path), `Forbidden packaged file ${path}`);
    if (path.endsWith('.js')) {
      codeFiles++;
      assert.ok(!/\beval\s*\(|new\s+Function\s*\(|importScripts\s*\(\s*['"]https?:/.test(source), `Executable string/remote loader ${path}`);
      assert.ok(!/chrome\.(scripting|history|webRequest)|browser\.(scripting|history|webRequest)|clipboard\.readText|tabs\.executeScript/.test(source), `Unrequested page access ${path}`);
      assert.ok(!/sk-proj-[a-zA-Z0-9_-]{20,}/.test(source), `Provider secret ${path}`);
    }
    if (path.endsWith('.html')) assert.ok(!/<script[^>]+src=["']https?:|<script(?![^>]*\bsrc=)[^>]*>\s*[^<\s]/i.test(source));
    if (path.endsWith('.css')) assert.ok(!/@import\s+['"]https?:|url\(\s*['"]?https?:/i.test(source));
  }
  assert.ok(codeFiles > 0);
  results.push({ browser, origin: origin.origin, placeholderOrigin: origin.hostname.endsWith('.example'), permissions: manifest.permissions, manifest, codeFiles, files: hashes });
}
await mkdir('docs/release', { recursive: true });
await writeFile('docs/release/package-audit.json', JSON.stringify({ testedAt: new Date().toISOString(), status: 'passed', scope: 'static production packages; runtime network evidence recorded separately', packages: results }, null, 2) + '\n');
console.info('Chrome/Edge/Firefox recursive package, permission and CSP audit passed');
