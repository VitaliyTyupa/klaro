import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JUDGE, instructions, JudgmentSchema, judgmentVerdict, calibrationCases, evaluationItems, judgePlan, hash, gateDecision, automaticConfiguration } from './language-judge.mjs';
import { parseEvaluationBudget } from './run-real-language-evaluation.mjs';
import { usageCost } from '../dist/api/ai/prices.js';
import { renderJudgeReview } from './language-judge-review.mjs';

export async function judgeRequest(payload, signal, apiKey, request = fetch) {
  if (!apiKey || apiKey.length < 8 || /\s/.test(apiKey)) throw new Error('Judge credentials required');
  const data = JSON.stringify(payload);
  if (Buffer.byteLength(instructions + data, 'utf8') + 128 > JUDGE.inputTokenLimit) throw new Error('Judge input exceeds bound');
  const properties = Object.fromEntries(['meaning', 'language', 'instruction'].map(k => [k, { type: 'string', enum: ['pass','fail','uncertain'] }]));
  properties.notes = { type: 'string' };
  const body = { model: JUDGE.model, store: false, stream: false, truncation: 'disabled', max_output_tokens: JUDGE.outputTokenLimit, instructions, input: [{ role: 'user', content: [{ type: 'input_text', text: data }] }], text: { format: { type: 'json_schema', name: 'klaro_language_judgment', strict: true, schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } } } };
  const response = await request('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]), redirect: 'error' });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Judge provider error'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Missing judge response');
  const chunks = []; let bytes = 0;
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 64000) { await reader.cancel(); throw new Error('Excess judge response'); } chunks.push(chunk.value); } } finally { reader.releaseLock(); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const usage = value.usage && [value.usage.input_tokens, value.usage.output_tokens].every(n => Number.isSafeInteger(n) && n >= 0) ? { inputTokens: value.usage.input_tokens, outputTokens: value.usage.output_tokens } : undefined;
  const content = (Array.isArray(value.output) ? value.output : []).filter(o => o.type === 'message').flatMap(o => o.content ?? []);
  let judgment;
  if (value.status === 'completed' && !content.some(c => c.type === 'refusal')) {
    try { judgment = JudgmentSchema.parse(JSON.parse(content.filter(c => c.type === 'output_text').map(c => c.text).join(''))); } catch { /* Invalid/refused judgments remain unresolved, with usage accounted. */ }
  }
  return { judgment, usage };
}

async function checkpoint(path, report) {
  delete report.digest; report.digest = hash(report);
  await writeFile(`${path}.next`, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); await rename(`${path}.next`, path);
}
export async function runJudge({ source, budgetMicrousd, reportPath, provider, signal = new AbortController().signal }) {
  const plan = judgePlan(source, source.policy);
  if (!Number.isSafeInteger(budgetMicrousd) || budgetMicrousd < plan.maxCostMicrousd) throw new Error('Full judge bound exceeds approved budget');
  const report = { version: 'language-judge-report-v1', reportId: `judge-${randomUUID()}`, createdAt: new Date().toISOString(), plan, budgetMicrousd, state: 'running', results: [] };
  await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report) + '\n', { flag: 'wx', mode: 0o600 });
  const items = [...calibrationCases(), ...evaluationItems(source, source.policy).filter(i => i.payload)];
  let spent = 0;
  for (const [index, item] of items.entries()) {
    if (signal.aborted) { report.state = 'interrupted'; break; }
    if (index === plan.calibrationCalls && !calibrationCases().every((c,i) => report.results[i].judgment && judgmentVerdict(report.results[i].judgment) === c.expected)) { report.state = 'calibration-failed'; break; }
    if (spent + plan.callBoundMicrousd > budgetMicrousd) { report.state = 'budget-blocked'; break; }
    const result = { id: item.id, usageKind: 'estimated', costMicrousd: plan.callBoundMicrousd, dispatchedAt: new Date().toISOString() };
    report.results.push(result); await checkpoint(reportPath, report);
    try {
      const response = await provider(item.payload, signal);
      if (response.usage) {
        const { inputTokens, outputTokens } = response.usage;
        if (![inputTokens, outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid judge usage');
        result.usageKind = 'actual'; result.usage = response.usage; result.costMicrousd = usageCost(JUDGE.price, inputTokens, outputTokens);
        if (inputTokens > JUDGE.inputTokenLimit || outputTokens > JUDGE.outputTokenLimit || result.costMicrousd > plan.callBoundMicrousd) report.state = 'budget-overrun';
      }
      if (response.judgment) result.judgment = JudgmentSchema.parse(response.judgment);
    } catch { result.failure = 'provider-or-invalid-judgment'; }
    spent += result.costMicrousd; result.completedAt = new Date().toISOString(); await checkpoint(reportPath, report);
    if (report.state === 'budget-overrun') break;
  }
  if (report.state === 'running') report.state = 'completed';
  report.completedAt = new Date().toISOString(); await checkpoint(reportPath, report); return report;
}

async function main() {
  const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const sourcePath = arg('source'); if (!sourcePath) throw new Error('Explicit --source required');
  const source = JSON.parse(await readFile(sourcePath, 'utf8'));
  if (process.argv.includes('--export') || process.argv.includes('--review')) {
    const judged = JSON.parse(await readFile(arg('report'), 'utf8'));
    const resolutions = arg('resolutions') ? JSON.parse(await readFile(arg('resolutions'), 'utf8')) : [];
    const decision = gateDecision(source, judged, resolutions); console.info(JSON.stringify(decision));
    if (process.argv.includes('--review') && arg('output')) await writeFile(arg('output'), renderJudgeReview(source, judged, resolutions), { flag: 'wx', mode: 0o600 });
    if (process.argv.includes('--export')) await writeFile(arg('output'), JSON.stringify(automaticConfiguration(source, judged, resolutions), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (!decision.passed) process.exitCode = 1; return;
  }
  const plan = judgePlan(source, source.policy);
  if (!process.argv.includes('--execute')) { console.info(JSON.stringify({ ...plan, paidCalls: 0 }, null, 2)); return; }
  const reportPath = arg('report'); if (!reportPath) throw new Error('Explicit --report required');
  const budgetMicrousd = parseEvaluationBudget(process.env.JUDGE_MAX_COST_MICROUSD);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.length < 8 || /\s/.test(apiKey)) throw new Error('Judge credentials required');
  const controller = new AbortController(); const abort = () => controller.abort(); process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const report = await runJudge({ source, budgetMicrousd, reportPath, signal: controller.signal, provider: (payload, signal) => judgeRequest(payload, signal, apiKey) });
    if (report.state === 'completed') { const decision = gateDecision(source, report); console.info(JSON.stringify(decision)); if (!decision.passed) process.exitCode = 1; }
    else { console.info(JSON.stringify({ state: report.state, calls: report.results.length })); process.exitCode = 1; }
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Language judge blocked; inspect local evidence/configuration. No automatic retry.'); process.exitCode = 1; });
