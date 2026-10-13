import { spawn } from 'node:child_process';
import { migrate } from './migrate.mjs';
try {
  await migrate();
  const children = ['dist/api/main.js', 'tools/serve-deployment.mjs'].map(file => spawn(process.execPath, [file], { stdio: 'inherit', env: process.env }));
  let stopping = false;
  const stop = code => { if (stopping) return; stopping = true; process.exitCode = code; for (const child of children) child.kill('SIGTERM'); };
  for (const child of children) child.on('exit', code => stop(code ?? 1));
  process.on('SIGTERM', () => stop(0)); process.on('SIGINT', () => stop(0));
} catch { console.error(JSON.stringify({ event: 'deployment-startup-failed' })); process.exitCode = 1; }
