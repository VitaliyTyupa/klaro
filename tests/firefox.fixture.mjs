import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function launchFirefox() {
  const root = resolve('dist/firefox-test-profiles'); await mkdir(root, { recursive: true });
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const display = process.env.KLARO_FIREFOX_X11_TCP === '1' && process.env.DISPLAY?.startsWith(':') ? `127.0.0.1${process.env.DISPLAY}` : process.env.DISPLAY;
  const child = spawn(process.env.GECKODRIVER_PATH ?? 'geckodriver', ['--port', String(port), '--allow-system-access', '--profile-root', root], { env: { ...process.env, ...(display ? { DISPLAY: display } : {}), MOZ_ENABLE_WAYLAND: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
  const request = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    const result = await response.json(); if (!response.ok) throw new Error(`${result.value?.error}: ${result.value?.message}`); return result.value;
  };
  let session;
  try {
    for (let index = 0; index < 100; index++) { try { await request('GET', '/status'); break; } catch { if (child.exitCode !== null) throw new Error(`Geckodriver unavailable: ${log}`); await new Promise(resolve => setTimeout(resolve, 50)); } }
    const result = await request('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { ...(process.env.FIREFOX_EXECUTABLE_PATH ? { binary: process.env.FIREFOX_EXECUTABLE_PATH } : {}), args: process.env.KLARO_BROWSER_HEADED === '1' ? [] : ['-headless'] } } } });
    session = result.sessionId;
    const command = (method, path, body) => request(method, `/session/${session}${path}`, body);
    return {
      version: result.capabilities.browserVersion, command,
      evaluate: (script, args = []) => command('POST', '/execute/sync', { script, args }),
      context: context => command('POST', '/moz/context', { context }),
      panel: async (fn, args = []) => command('POST', '/execute/async', {
        script: 'const done=arguments[arguments.length-1];const b=document.getElementById("sidebar").contentDocument?.getElementById("webext-panels-browser");if(!b?.browsingContext?.currentWindowGlobal){done(null);return;}const actor=b.browsingContext.currentWindowGlobal.getActor("MarionetteCommands");actor.executeScript(arguments[0],arguments[1],{sandboxName:null,newSandbox:true,async:false}).then(done,e=>done({fixtureError:e.message}));',
        args: [`return (${fn.toString()})(...arguments)`, args],
      }),
      clickPanel: async name => command('POST', '/execute/async', {
        script: 'const done=arguments[arguments.length-1];const actor=document.getElementById("sidebar").contentDocument.getElementById("webext-panels-browser").browsingContext.currentWindowGlobal.getActor("MarionetteCommands");actor.executeScript(arguments[1],[arguments[0]],{}).then(async p=>{for(const type of ["mousedown","mouseup"])await actor.dispatchEvent("synthesizeMouseAtPoint",{x:p.x,y:p.y,eventData:{type,button:0}});done(true)},e=>done({fixtureError:e.message}));',
        args: [name, "const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===arguments[0]);if(!b||b.disabled)throw new Error('Button unavailable');b.scrollIntoView();const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}"],
      }),
      close: async () => { await command('DELETE', '').catch(() => {}); child.kill(); },
    };
  } catch (error) { if (session) await request('DELETE', `/session/${session}`).catch(() => {}); child.kill(); if (!session) throw new Error(`Firefox startup failed: ${error.message}\n${log}`); throw error; }
}
