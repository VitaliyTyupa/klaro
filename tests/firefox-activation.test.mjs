import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { browserIdentity } from '../apps/extension/src/identity-port.ts';

test('Firefox activation requires only browser action, commands and sidebarAction', () => {
  let action; let command; let opens = 0;
  runInNewContext(readFileSync('apps/extension/browser/firefox-background.js', 'utf8'), { browser: { action: { onClicked: { addListener: callback => { action = callback; } } }, commands: { onCommand: { addListener: callback => { command = callback; } } }, sidebarAction: { open: () => { opens++; return Promise.resolve(); } } } });
  assert.equal(opens, 0); action(); assert.equal(opens, 1);
  command('unrelated'); assert.equal(opens, 1); command('open-klaro'); assert.equal(opens, 2);
});

test('identity port works when only Firefox browser global exists', () => {
  const previous = globalThis.browser;
  try { const identity = {}; globalThis.browser = { identity }; assert.equal(browserIdentity(), identity); }
  finally { if (previous === undefined) delete globalThis.browser; else globalThis.browser = previous; }
});
