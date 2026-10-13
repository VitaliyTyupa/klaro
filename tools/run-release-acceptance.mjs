import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const path = 'docs/release/acceptance-run.json';
const retry = process.argv.includes('--retry-failed');
const report = retry ? JSON.parse(await readFile(path, 'utf8')) : { version: 'release-acceptance-v1', startedAt: new Date().toISOString(), provider: 'synthetic-fixtures-only', paidCalls: 0, state: 'running', checks: [] };
if (retry) { if (report.state !== 'failed' || report.version !== 'release-acceptance-v1') throw new Error('Retry requires a completed failed acceptance run'); report.resumedAt = new Date().toISOString(); report.state = 'running'; }
await mkdir('docs/release', { recursive: true });
const save = () => writeFile(path, JSON.stringify(report, null, 2) + '\n');
async function run(name, command, args, environment = {}) {
  const index = report.checks.findIndex(check => check.name === name);
  const previous = report.checks[index];
  if (retry && previous?.status === 'passed') return;
  const check = { name, command: [command, ...args], startedAt: new Date().toISOString(), status: 'running', ...(name.startsWith('Native ') ? { matrixBrowsers: process.env.KLARO_MATRIX_BROWSERS ?? 'chrome,edge,firefox' } : {}), ...(previous ? { previousAttempts: [...(previous.previousAttempts ?? []), { startedAt: previous.startedAt, completedAt: previous.completedAt, status: previous.status, exitCode: previous.exitCode, ...(previous.matrixBrowsers ? { matrixBrowsers: previous.matrixBrowsers } : {}) }] } : {}) };
  if (index < 0) report.checks.push(check); else report.checks[index] = check;
  await save();
  console.info(`Acceptance: ${name}`);
  const code = await new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...environment } }); child.on('error', reject); child.on('exit', code => resolve(code)); });
  check.completedAt = new Date().toISOString(); check.exitCode = code; check.status = code === 0 ? 'passed' : 'failed'; await save();
  if (code !== 0 && (name.startsWith('CI:') || name === 'Database migrations')) throw new Error(`Acceptance prerequisite failed: ${name}`);
}
try {
  await run('CI: lint, unit, typecheck, production builds', 'npm', ['run', 'ci']);
  await run('Database migrations', process.execPath, ['--env-file-if-exists=.env', 'tools/migrate.mjs']);
  for (const file of ['identity', 'oidc', 'sessions', 'handoff', 'operations-schema', 'operations', 'payloads', 'budgets', 'recovery', 'translation', 'reference', 'privacy']) await run(`${file} integration`, process.execPath, ['--env-file-if-exists=.env', `tests/${file}.integration.mjs`]);
  await run('Proxy privacy canaries', process.execPath, ['--test', 'tests/proxy-privacy.integration.mjs']);
  for (const file of ['preferences', 'editor', 'reference', 'chrome-lifecycle']) await run(`${file} browser`, process.execPath, [`tests/${file}.browser.mjs`]);
  await run('Native Chrome/Edge/Firefox correction and translation matrix', 'xvfb-run', ['-a', process.execPath, 'tools/run-browser-matrix.mjs'], { KLARO_BROWSER_HEADED: '1', GECKODRIVER_PATH: process.env.GECKODRIVER_PATH ?? '/snap/firefox/current/usr/lib/firefox/geckodriver', FIREFOX_EXECUTABLE_PATH: process.env.FIREFOX_EXECUTABLE_PATH ?? `${process.cwd()}/dist/test-browsers/firefox/firefox` });
  for (const browser of ['chrome', 'edge', 'firefox']) await run(`${browser} production packaging`, process.execPath, ['tools/package-extension.mjs', `--browser=${browser}`]);
  await run('Recursive package audit', process.execPath, ['tools/audit-extension-packages.mjs']);
  report.browserMatrixEvidence = [];
  for (const file of ['chrome-panel', 'chrome-web', 'edge-panel', 'edge-web', 'firefox-panel']) {
    const evidencePath = `docs/evaluations/browser-matrix/${file}.json`;
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    assert.ok(new Date(evidence.testedAt) >= new Date(report.startedAt), `Stale matrix evidence: ${file}`);
    assert.equal(evidence.cases.length, 24);
    assert.equal(new Set(evidence.cases.map(c => `${c.nativeLanguage}/${c.activeWritingLanguage}/${c.style}`)).size, 24);
    assert.ok(evidence.cases.every(c => c.operations === 3 && c.providerAttempts === 4 && c.overlongBlocked && c.selectionOnly && c.swapPreservesProfile && c.staleCopyBlocked));
    report.browserMatrixEvidence.push({ path: evidencePath, testedAt: evidence.testedAt, version: evidence.version, cases: evidence.cases.length });
  }
  report.state = report.checks.every(check => check.status === 'passed') ? 'passed' : 'failed';
  if (report.state === 'failed') process.exitCode = 1;
} catch (error) { report.state = 'failed'; console.error(error.message); process.exitCode = 1; }
finally { report.completedAt = new Date().toISOString(); await save(); }
