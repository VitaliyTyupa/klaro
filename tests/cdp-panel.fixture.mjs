import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

// Chromium exposes side-panel documents as page targets without a tab wrapper.
export async function attachPanel(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  const pending = new Map(); let next = 0; const errorListeners = [];
  cdp.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.id) { const waiter = pending.get(message.id); if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result); } }
    if (message.method === 'Runtime.exceptionThrown') for (const listener of errorListeners) listener(new Error('Native panel runtime exception'));
  });
  const send = async (method, params = {}) => {
    const id = ++next;
    const response = new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Panel CDP timeout: ${method}`)); }, 10000); pending.set(id, { resolve, reject, timer }); });
    await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }); return response;
  };
  await send('Runtime.enable');
  const expression = (fn, argument) => `(${fn.toString()})(${JSON.stringify(argument) ?? 'undefined'})`;
  const evaluate = async (fn, argument) => { const result = await send('Runtime.evaluate', { expression: expression(fn, argument), returnByValue: true, awaitPromise: true, userGesture: true }); assert.equal(result.exceptionDetails, undefined, 'Native panel evaluation failed'); return result.result.value; };
  const wait = async (predicate, timeout = 10000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error('Native panel condition timed out'); };
  const roleElements = `function(role, name) { return [...document.querySelectorAll(role === 'textbox' ? 'textarea' : 'button')].filter(element => name === undefined || (role === 'textbox' ? [...element.labels].some(label => label.textContent.trim() === name) : element.textContent.trim() === name)); }`;
  const locate = (role, name) => {
    const query = `(${roleElements})(${JSON.stringify(role)},${JSON.stringify(name)})`;
    const run = async suffix => { const result = await send('Runtime.evaluate', { expression: `(() => { const matches = ${query}; ${suffix} })()`, returnByValue: true, awaitPromise: true, userGesture: true }); assert.equal(result.exceptionDetails, undefined, 'Native panel locator failed'); return result.result.value; };
    return {
      waitFor: async options => wait(() => run('return matches.some(element => element.getClientRects().length > 0);'), options?.timeout),
      click: async () => {
        await wait(() => run('return matches.some(element => !element.disabled);'));
        await send('Page.bringToFront');
        const point = await run('matches[0].scrollIntoView({ block: "center" }); const rect = matches[0].getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };');
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      },
      fill: async value => { await wait(() => run('return matches.length === 1;')); await run(`matches[0].focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(matches[0], ${JSON.stringify(value)}); matches[0].dispatchEvent(new Event('input', { bubbles: true }));`); },
      inputValue: () => run('return matches[0].value;'),
      count: () => run('return matches.length;'),
    };
  };
  return {
    evaluate,
    waitForFunction: (fn, argument) => wait(async () => Boolean(await evaluate(fn, argument))),
    getByRole: (role, options) => locate(role, options?.name),
    getByText: text => ({ waitFor: () => wait(() => evaluate(text => [...document.querySelectorAll('p')].some(element => element.textContent.trim() === text), text)) }),
    on: (event, listener) => { if (event === 'pageerror') errorListeners.push(listener); },
    screenshot: async ({ path }) => { const { data } = await send('Page.captureScreenshot'); await writeFile(path, Buffer.from(data, 'base64')); },
  };
}
