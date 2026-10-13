import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('worker activates the panel synchronously using only the supplied window identifier', async () => {
  const calls = []; let command;
  runInNewContext(readFileSync('apps/extension/browser/service-worker.js', 'utf8'), { chrome: { sidePanel: { setPanelBehavior: value => { calls.push(value.openPanelOnActionClick); return Promise.resolve(); }, open: value => { calls.push(value.windowId); return Promise.resolve(); } }, commands: { onCommand: { addListener: callback => { command = callback; } } } } });
  assert.deepEqual(calls, [true]);
  const tab = { windowId: 7, get url() { throw new Error('Third-party URL must never be read'); }, get title() { throw new Error('Third-party title must never be read'); } };
  command('unrelated', tab); assert.deepEqual(calls, [true]);
  command('open-klaro', tab); assert.deepEqual(calls, [true, 7]);
  command('open-klaro'); assert.deepEqual(calls, [true, 7]);
});
