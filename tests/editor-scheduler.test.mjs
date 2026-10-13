import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorSession } from '../packages/editor/src/session.ts';
import { EditorScheduler } from '../packages/editor/src/scheduler.ts';
function fixture() {
  let now = 0; let next = 0; const timers = new Map();
  const clock = { set(callback, milliseconds) { const id = ++next; timers.set(id, { callback, time: now + milliseconds }); return id; }, clear(id) { timers.delete(id); } };
  const tick = async milliseconds => { now += milliseconds; for (const [id, timer] of [...timers]) if (timer.time <= now) { timers.delete(id); timer.callback(); } await new Promise(resolve => setImmediate(resolve)); };
  const session = new EditorSession(); const calls = [];
  const port = { execute: async (command, signal) => { calls.push({ command, signal }); return { version: 'v1', operationId: `operation-${calls.length}`, revisionId: command.revisionId, sequence: 1, status: 'completed', resultVersion: 1, payloadStatus: 'available', results: [{ kind: 'translation', language: command.targetLanguage, revisionId: command.revisionId, text: 'Synthetic result', warnings: [] }] }; } };
  const scheduler = new EditorScheduler(session, port, 'panel', clock);
  return { session, calls, scheduler, tick };
}

test('explicit run and opt-in live debounce typing bursts without feedback calls', async () => {
  const { session, calls, scheduler, tick } = fixture();
  session.setInput('One'); await tick(5000); assert.equal(calls.length, 0);
  await scheduler.run(); assert.equal(calls.length, 1);
  scheduler.setLive(true); session.setInput('Two'); await tick(500); session.setInput('Three'); await tick(999); assert.equal(calls.length, 1);
  await tick(1); assert.equal(calls.length, 2); await tick(5000); assert.equal(calls.length, 2);
  session.setInput('Three'); await tick(1000); assert.equal(calls.length, 2);
  session.setMode('translation'); await tick(1000); assert.equal(calls.length, 3); assert.equal(calls[2].command.sourceLanguage, 'uk');
  session.setPreferences({ ...session.preferences, writingLanguages: ['de', 'en'], activeWritingLanguage: 'en' }); await tick(1000); assert.equal(calls.length, 4); assert.equal(calls[3].command.targetLanguage, 'en');
  session.setInput('Pending'); scheduler.pause(); await tick(5000); assert.equal(calls.length, 4); assert.equal(scheduler.live, false);
  scheduler.dispose(); session.setInput('Closed'); await tick(5000); assert.equal(calls.length, 4);
});

test('late results after input change or pause cannot overwrite the current revision', async () => {
  const session = new EditorSession(); session.setInput('Original'); let finish;
  const scheduler = new EditorScheduler(session, { execute: command => new Promise(resolve => { finish = () => resolve({ version: 'v1', operationId: 'operation-one', revisionId: command.revisionId, sequence: 1, status: 'completed', resultVersion: 1, payloadStatus: 'available', results: [{ kind: 'translation', revisionId: command.revisionId, text: 'Late', warnings: [] }] }); }) }, 'panel');
  const running = scheduler.run(); session.setInput('New draft'); finish(); await running; assert.equal(session.result, undefined);
  const next = scheduler.run(); scheduler.pause(); finish(); await next; assert.equal(session.result, undefined);
  scheduler.dispose();
});
