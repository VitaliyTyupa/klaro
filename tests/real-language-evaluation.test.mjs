import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DeterministicProvider } from '../dist/api/ai/double.js';
import { OpenAiResponsesAdapter } from '../dist/api/ai/openai-responses.js';
import { ProviderFailure } from '../dist/api/ai/provider.js';
import { PolicyRegistry } from '../dist/api/ai/policies.js';
import { evaluationFixtures, REVIEW_CRITERIA } from '../tools/language-evaluation-fixtures.mjs';
import { evaluationPlan, readCandidate, parseEvaluationBudget, runEvaluation, reviewedConfiguration } from '../tools/run-real-language-evaluation.mjs';

const policy = await readCandidate('deployment/policies.openai.candidate.json');
const fixtures = evaluationFixtures();
const reviewers = { uk: 'test-uk', de: 'test-de', en: 'test-en', vi: 'test-vi' };

test('evaluation covers all languages, ordered translation pairs and grammar cases without activating draft', () => {
  const plan = evaluationPlan(policy);
  assert.equal(plan.commands, 72); assert.equal(plan.plannedCalls, 96);
  assert.equal(plan.maxCostMicrousd, 1258368);
  assert.equal(fixtures.filter(f => f.id.endsWith('-grammar')).length, 4);
  const translations = fixtures.filter(f => f.command.operationType === 'translation');
  assert.equal(translations.length, 24);
  assert.equal(new Set(translations.map(f => `${f.command.sourceLanguage}-${f.command.targetLanguage}`)).size, 12);
  assert.throws(() => new PolicyRegistry([policy], policy.version, 'openai'));
  for (const invalid of ['$1', '2.00', '0', '-1', '2000000x', String(Number.MAX_SAFE_INTEGER + 1)]) assert.throws(() => parseEvaluationBudget(invalid));
  assert.equal(parseEvaluationBudget('2000000'), 2000000);
});

test('evaluation preflight prevents spend and overwrite; unknown calls stay charged and are not retried', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'klaro-eval-'));
  let calls = 0;
  const provider = { id: 'openai', execute: async () => { calls++; throw new ProviderFailure('indeterminate'); } };
  const options = { policy, budgetMicrousd: 2000000, reviewers, reportPath: join(dir, 'report.json'), provider };
  try {
    await assert.rejects(runEvaluation({ ...options, budgetMicrousd: 1 }), /bound exceeds/);
    await assert.rejects(runEvaluation({ ...options, reviewers: { ...reviewers, vi: null } }));
    assert.equal(calls, 0);
    const report = await runEvaluation(options);
    // Failed primary stages do not dispatch their dependent native stages.
    assert.equal(calls, 72);
    assert.equal(report.summary.actualCostMicrousd, 0);
    assert.equal(report.summary.estimatedCostMicrousd, calls * 13108);
    assert.ok(report.cases.every(c => c.stages[0].outcome === 'indeterminate'));
    const saved = JSON.parse(await readFile(options.reportPath, 'utf8'));
    assert.equal(saved.summary.estimatedCostMicrousd, report.summary.estimatedCostMicrousd);
    await assert.rejects(runEvaluation(options), /EEXIST/);
    assert.equal(calls, 72);
    assert.throws(() => reviewedConfiguration(report, policy), /Incomplete evaluation coverage|Contract failure/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('mock OpenAI evaluation preserves outputs and requires complete human review before export', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'klaro-eval-review-'));
  const double = new DeterministicProvider();
  let calls = 0;
  // Exercise the production adapter with injected HTTP; no real credentials or network.
  let task;
  const adapter = new OpenAiResponsesAdapter('synthetic-test-key', async (_url, request) => {
    calls++;
    const body = JSON.parse(request.body); assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
    const response = await double.execute(task, new AbortController().signal);
    return new Response(JSON.stringify({ status: 'completed', usage: { input_tokens: 1000, output_tokens: 100 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(response.candidate) }] }] }), { status: 200 });
  });
  const provider = { id: 'openai', execute: async (t, signal) => { task = t; return adapter.execute(t, signal); } };
  try {
    const report = await runEvaluation({ policy, budgetMicrousd: 2000000, reviewers, reportPath: join(dir, 'report.json'), provider });
    assert.equal(calls, 96); assert.equal(report.summary.contractPassed, 96);
    assert.equal(report.summary.actualCostMicrousd, 96 * 560);
    assert.throws(() => reviewedConfiguration(report, policy), /human review/);
    for (const c of report.cases) for (const s of c.stages) for (const r of Object.values(s.humanReview)) {
      // Synthetic test judgments only; these reports stay in temporary directories.
      r.criteria = Object.fromEntries(REVIEW_CRITERIA.map(c => [c, 'pass'])); r.reviewedAt = new Date().toISOString(); r.notes = 'Synthetic sign-off validation test';
    }
    const config = reviewedConfiguration(report, policy);
    assert.equal(new PolicyRegistry(config.policies, config.active, 'openai').current().model.model, policy.model.model);
    const failed = structuredClone(report); failed.cases[0].stages[0].humanReview.de.criteria.meaning = 'fail';
    assert.throws(() => reviewedConfiguration(failed, policy), /human review/);
    const forged = structuredClone(report); forged.cases[0].stages[0].candidate.text = 'Changed evidence';
    assert.throws(() => reviewedConfiguration(forged, policy), /changed evaluation evidence/);
    assert.throws(() => reviewedConfiguration(report, { ...policy, promptVersion: 'language-v4' }), /changed evaluation evidence/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cancellation and excessive provider usage stop subsequent calls', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'klaro-eval-stop-'));
  const controller = new AbortController(); let calls = 0;
  try {
    const provider = { id: 'openai', execute: async () => { calls++; controller.abort(); throw new ProviderFailure('indeterminate'); } };
    const report = await runEvaluation({ policy, budgetMicrousd: 2000000, reviewers, reportPath: join(dir, 'cancel.json'), provider, signal: controller.signal });
    assert.equal(calls, 1); assert.equal(report.state, 'interrupted');
    const overrun = { id: 'openai', execute: async () => { calls++; return { outcome: 'incomplete', usage: { inputTokens: 999999, outputTokens: 1 } }; } };
    const second = await runEvaluation({ policy, budgetMicrousd: 2000000, reviewers, reportPath: join(dir, 'overrun.json'), provider: overrun });
    assert.equal(calls, 2); assert.equal(second.state, 'budget-overrun');
    assert.ok(second.summary.actualCostMicrousd > 13108);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
