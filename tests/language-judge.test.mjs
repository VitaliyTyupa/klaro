import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeterministicProvider } from '../dist/api/ai/double.js';
import { PolicyRegistry } from '../dist/api/ai/policies.js';
import { readCandidate, runEvaluation } from '../tools/run-real-language-evaluation.mjs';
import { JUDGE, calibrationCases, hash, judgePlan, gateDecision, automaticConfiguration } from '../tools/language-judge.mjs';
import { runJudge, judgeRequest } from '../tools/run-language-judge.mjs';
import { renderJudgeReview } from '../tools/language-judge-review.mjs';

const policy = await readCandidate('deployment/policies.openai.candidate.json');
const pass = { meaning: 'pass', language: 'pass', instruction: 'pass', notes: 'Synthetic test judgment' };
const usage = { inputTokens: 100, outputTokens: 10 };
function refreshDigest(report) { delete report.digest; report.digest = hash(report); }
function calibratedProvider() { let index = 0; return async () => ({ judgment: index < 12 ? { ...pass, meaning: calibrationCases()[index++].expected } : pass, usage }); }

test('judge plans existing evidence without spend and rejects changed machine outputs', async () => {
  const source = JSON.parse(await readFile('docs/evaluations/openai-run-v1.json', 'utf8'));
  const plan = judgePlan(source, source.policy); assert.equal(plan.maxCalls, 92); assert.equal(plan.maxCostMicrousd, 1130496); assert.equal(plan.contractPassed, false);
  source.cases[0].stages[0].candidate.text += 'Changed';
  assert.throws(() => judgePlan(source, source.policy), /Invalid evaluation evidence/);
});

test('automatic gate exports without mass human review and resolves only uncertain cases', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'klaro-judge-'));
  try {
    const double = new DeterministicProvider();
    const source = await runEvaluation({ policy, budgetMicrousd: 2000000, automaticReview: true, reportPath: join(dir, 'source.json'), provider: { id: 'openai', execute: (task, signal) => double.execute(task, signal) } });
    assert.equal('humanReview' in source.cases[0].stages[0], false); assert.equal('reviewers' in source, false);
    const options = { source, budgetMicrousd: 2000000, reportPath: join(dir, 'judge.json'), provider: calibratedProvider() };
    await assert.rejects(runJudge({ ...options, budgetMicrousd: 1 }), /bound/);
    const judged = await runJudge(options); assert.equal(judged.results.length, 108);
    assert.equal(gateDecision(source, judged).passed, true);
    const config = automaticConfiguration(source, judged);
    assert.equal(config.policies[0].evaluation.kind, 'automatic-language-gate-v1');
    assert.equal('humanReviewPassed' in config.policies[0].evaluation, false);
    assert.equal(new PolicyRegistry(config.policies, config.active, 'openai').current().version, policy.version);
    await assert.rejects(runJudge(options), /EEXIST/);
    const disputed = structuredClone(judged); disputed.results[12].judgment.meaning = 'uncertain'; refreshDigest(disputed);
    assert.equal(gateDecision(source, disputed).passed, false);
    const resolution = { id: disputed.results[12].id, verdict: 'pass', reviewer: 'test-reviewer', reviewedAt: new Date().toISOString(), notes: 'Synthetic disputed-case review' };
    assert.equal(gateDecision(source, disputed, [resolution]).passed, true);
    assert.throws(() => gateDecision(source, judged, [resolution]), /Only disputed/);
    const failed = structuredClone(judged); failed.results[12].judgment.meaning = 'fail'; refreshDigest(failed);
    assert.equal(gateDecision(source, failed).passed, false); assert.throws(() => automaticConfiguration(source, failed), /blocked/);
    assert.equal(gateDecision(source, failed, [resolution]).passed, true);
    const forged = structuredClone(judged); forged.results[12].judgment.meaning = 'fail';
    assert.throws(() => gateDecision(source, forged), /Invalid judge evidence/);
    assert.throws(() => new PolicyRegistry([{ ...config.policies[0], evaluation: { ...config.policies[0].evaluation, calibrationPassed: false } }], config.active, 'openai'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('calibration failure stops further paid dispatch and contract failures cannot be overridden', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'klaro-judge-stop-'));
  const source = JSON.parse(await readFile('docs/evaluations/openai-run-v1.json', 'utf8'));
  try {
    let calls = 0;
    const failed = await runJudge({ source, budgetMicrousd: 2000000, reportPath: join(dir, 'failed.json'), provider: async () => { calls++; return { judgment: pass, usage }; } });
    assert.equal(failed.state, 'calibration-failed'); assert.equal(calls, 12);
    const judged = await runJudge({ source, budgetMicrousd: 2000000, reportPath: join(dir, 'contracts.json'), provider: calibratedProvider() });
    const decision = gateDecision(source, judged); assert.equal(decision.languagePassed, true); assert.equal(decision.contractPassed, false); assert.equal(decision.passed, false);
    const html = renderJudgeReview(source, judged); assert.match(html, /заблоковано/); assert.match(html, /17/);
    const marked = structuredClone(judged); marked.results[12].judgment.notes = '<script>private()</script>'; refreshDigest(marked);
    assert.ok(renderJudgeReview(source, marked).includes('&lt;script&gt;')); assert.equal(renderJudgeReview(source, marked).includes('<script>'), false);
    assert.throws(() => automaticConfiguration(source, judged), /blocked/);
    const unknown = await runJudge({ source, budgetMicrousd: 2000000, reportPath: join(dir, 'unknown.json'), provider: async () => { throw new Error('unknown'); } });
    assert.equal(unknown.state, 'calibration-failed'); assert.ok(unknown.results.every(r => r.usageKind === 'estimated' && r.costMicrousd === 12288));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('judge adapter uses bounded untrusted payload, no tools or stored conversations', async () => {
  let calls = 0;
  const response = await judgeRequest(calibrationCases()[0].payload, new AbortController().signal, 'synthetic-key', async (url, init) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(init.body); assert.equal(body.store, false); assert.equal(body.model, JUDGE.model); assert.equal(body.max_output_tokens, 512); assert.equal(body.text.format.strict, true);
    assert.equal('tools' in body, false); assert.equal('previous_response_id' in body, false); assert.equal('expected' in JSON.parse(body.input[0].content[0].text), false);
    return new Response(JSON.stringify({ status: 'completed', usage: { input_tokens: 100, output_tokens: 10 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(pass) }] }] }));
  });
  assert.equal(calls, 1); assert.deepEqual(response.judgment, pass);
  await assert.rejects(judgeRequest({ input: 'x'.repeat(10000) }, new AbortController().signal, 'synthetic-key', async () => { calls++; }), /bound/); assert.equal(calls, 1);
});
