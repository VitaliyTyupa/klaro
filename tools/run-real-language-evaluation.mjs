import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseEvaluationCandidate, PolicyRegistry } from '../dist/api/ai/policies.js';
import { OpenAiResponsesAdapter } from '../dist/api/ai/openai-responses.js';
import { ProviderFailure } from '../dist/api/ai/provider.js';
import { validateResult } from '../dist/api/ai/result-validation.js';
import { inputTokenUpperBound } from '../dist/api/ai/task.js';
import { usageCost } from '../dist/api/ai/prices.js';
import { workflowFor } from '../dist/api/ai/workflows.js';
import { evaluationFixtures, FIXTURE_VERSION, LANGUAGES, REVIEW_CRITERIA } from './language-evaluation-fixtures.mjs';

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const reviewersSchema = z.strictObject(Object.fromEntries(LANGUAGES.map(language => [language, identifier])));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function readCandidate(path) {
  const config = z.strictObject({ active: identifier, policies: z.array(z.unknown()).min(1).max(20) }).parse(JSON.parse(await readFile(path, 'utf8')));
  const matches = config.policies.filter(p => p.version === config.active);
  if (matches.length !== 1) throw new Error('Exactly one active evaluation candidate required');
  return parseEvaluationCandidate(matches[0]);
}
export function primaryTask(fixture, policy) {
  const command = fixture.command;
  const stage = workflowFor(command, policy).stages[0];
  const text = command.selection.scope === 'selection' ? command.input.slice(command.selection.start, command.selection.end) : command.input;
  return { command, stageId: stage.id, resultKind: stage.kind, text, sourceLanguage: command.sourceLanguage, targetLanguage: command.targetLanguage, ...(command.recommendation ? { recommendationId: command.recommendation.recommendationId } : {}), policy: policy.model, promptVersion: policy.promptVersion };
}
export function evaluationPlan(policy, fixtures = evaluationFixtures()) {
  if (new Set(fixtures.map(f => f.id)).size !== fixtures.length) throw new Error('Duplicate evaluation case');
  for (const fixture of fixtures) if (inputTokenUpperBound(primaryTask(fixture, policy)) > policy.model.inputTokenLimit) throw new Error('Fixture exceeds model input limit');
  const plannedCalls = fixtures.reduce((sum, f) => sum + workflowFor(f.command, policy).stages.length, 0);
  const callBoundMicrousd = usageCost(policy.price, policy.model.inputTokenLimit, policy.model.outputTokenLimit);
  const maxCostMicrousd = callBoundMicrousd * plannedCalls;
  if (!Number.isSafeInteger(maxCostMicrousd)) throw new Error('Unsafe evaluation budget');
  return { fixtureVersion: FIXTURE_VERSION, fixtureDigest: hash(fixtures), policyDigest: hash(policy), commands: fixtures.length, plannedCalls, callBoundMicrousd, maxCostMicrousd };
}
export function parseEvaluationBudget(value) {
  if (!/^[1-9][0-9]*$/.test(value ?? '') || !Number.isSafeInteger(Number(value))) throw new Error('EVALUATION_MAX_COST_MICROUSD requires positive integer micro-USD');
  return Number(value);
}
export function evidenceDigest(report) {
  const copy = structuredClone(report);
  delete copy.evidenceDigest;
  for (const c of copy.cases) for (const s of c.stages) delete s.humanReview;
  return hash(copy);
}
function summary(report) {
  const stages = report.cases.flatMap(c => c.stages);
  return { providerAttempts: stages.length, contractPassed: stages.filter(s => s.contract === 'passed').length, actualCostMicrousd: stages.filter(s => s.usageKind === 'actual').reduce((sum, s) => sum + s.costMicrousd, 0), estimatedCostMicrousd: stages.filter(s => s.usageKind === 'estimated').reduce((sum, s) => sum + s.costMicrousd, 0) };
}
async function checkpoint(path, report) {
  report.summary = summary(report);
  report.evidenceDigest = evidenceDigest(report);
  await writeFile(`${path}.next`, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await rename(`${path}.next`, path);
}

export async function runEvaluation({ policy, budgetMicrousd, reviewers, automaticReview = false, reportPath, provider, signal = new AbortController().signal, fixtures = evaluationFixtures() }) {
  if (!automaticReview) reviewers = reviewersSchema.parse(reviewers);
  if (!Number.isSafeInteger(budgetMicrousd) || budgetMicrousd <= 0) throw new Error('Approved evaluation budget required');
  const plan = evaluationPlan(policy, fixtures);
  if (plan.maxCostMicrousd > budgetMicrousd) throw new Error('Full evaluation bound exceeds approved budget');
  if (provider.id !== 'openai') throw new Error('Real evaluation requires OpenAI adapter');
  const report = { version: 'real-language-evaluation-v1', reportId: `language-eval-${randomUUID()}`, createdAt: new Date().toISOString(), realModelEvaluation: true, provider: 'openai', policy, plan, ...(automaticReview ? { reviewMode: 'automatic' } : { reviewers }), apiBudgetMicrousd: budgetMicrousd, state: 'running', languageReadiness: 'unreviewed', cases: fixtures.map(f => ({ caseId: f.id, command: f.command, stages: [] })) };
  await mkdir(dirname(reportPath), { recursive: true });
  // Exclusive claim prevents overwrite, resume or competing dispatches for one report.
  await writeFile(reportPath, JSON.stringify(report) + '\n', { flag: 'wx', mode: 0o600 });
  await checkpoint(reportPath, report);
  for (let index = 0; index < fixtures.length; index++) {
    if (signal.aborted || report.state === 'budget-overrun') break;
    let task = primaryTask(fixtures[index], policy);
    const expected = workflowFor(task.command, policy).stages;
    for (let stageIndex = 0; stageIndex < expected.length; stageIndex++) {
      if (signal.aborted) break;
      if (inputTokenUpperBound(task) > policy.model.inputTokenLimit) { report.cases[index].failure = 'input-too-large'; break; }
      const used = summary(report);
      if (used.actualCostMicrousd + used.estimatedCostMicrousd + plan.callBoundMicrousd > budgetMicrousd) { report.state = 'budget-overrun'; break; }
      const reviewLanguages = [...new Set([task.sourceLanguage, task.targetLanguage])];
      const stage = { stageId: task.stageId, sourceLanguage: task.sourceLanguage, targetLanguage: task.targetLanguage, input: task.text, outcome: 'indeterminate', contract: 'pending', usageKind: 'estimated', inputTokens: policy.model.inputTokenLimit, outputTokens: policy.model.outputTokenLimit, costMicrousd: plan.callBoundMicrousd, dispatchedAt: new Date().toISOString(), ...(automaticReview ? {} : { humanReview: Object.fromEntries(reviewLanguages.map(language => [language, { reviewer: reviewers[language], criteria: Object.fromEntries(REVIEW_CRITERIA.map(c => [c, 'pending'])), reviewedAt: null, notes: null }])) }) };
      report.cases[index].stages.push(stage);
      // Persist conservative charge before dispatch, so a crash cannot look free.
      await checkpoint(reportPath, report);
      let result;
      try {
        const response = await provider.execute(task, signal);
        stage.outcome = response.outcome;
        if (response.usage && [response.usage.inputTokens, response.usage.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) {
          stage.usageKind = 'actual'; stage.inputTokens = response.usage.inputTokens; stage.outputTokens = response.usage.outputTokens;
          stage.costMicrousd = usageCost(policy.price, stage.inputTokens, stage.outputTokens);
          if (stage.inputTokens > policy.model.inputTokenLimit || stage.outputTokens > policy.model.outputTokenLimit || stage.costMicrousd > plan.callBoundMicrousd) report.state = 'budget-overrun';
        }
        stage.candidate = response.candidate;
        result = response.outcome === 'complete' ? validateResult(task, response.candidate) : undefined;
        stage.contract = result ? 'passed' : 'failed';
      } catch (error) {
        stage.outcome = error instanceof ProviderFailure ? error.code : 'indeterminate';
        stage.contract = 'failed';
      }
      stage.completedAt = new Date().toISOString();
      await checkpoint(reportPath, report);
      if (!result || report.state === 'budget-overrun') break;
      if (stageIndex + 1 < expected.length) {
        task = { ...task, stageId: 'native-rendering', resultKind: 'translation', text: result.text, sourceLanguage: task.command.preferences.activeWritingLanguage, targetLanguage: task.command.preferences.nativeLanguage, recommendationId: result.recommendationId };
      }
    }
  }
  report.state = report.state === 'budget-overrun' ? report.state : signal.aborted ? 'interrupted' : 'completed';
  report.completedAt = new Date().toISOString();
  await checkpoint(reportPath, report);
  return report;
}

export function reviewedConfiguration(report, policy, fixtures = evaluationFixtures()) {
  const plan = evaluationPlan(policy, fixtures);
  if (report.version !== 'real-language-evaluation-v1' || report.provider !== 'openai' || report.realModelEvaluation !== true || report.state !== 'completed' || hash(report.policy) !== hash(policy) || hash(report.plan) !== hash(plan) || report.evidenceDigest !== evidenceDigest(report)) throw new Error('Invalid or changed evaluation evidence');
  identifier.parse(report.reportId);
  const reviewers = reviewersSchema.parse(report.reviewers);
  if (report.cases.length !== fixtures.length || report.cases.some((c, i) => c.caseId !== fixtures[i].id || hash(c.command) !== hash(fixtures[i].command) || c.stages.length !== workflowFor(c.command, policy).stages.length)) throw new Error('Incomplete evaluation coverage');
  for (const c of report.cases) {
    let task = primaryTask(fixtures.find(f => f.id === c.caseId), policy);
    for (const stage of c.stages) {
      if (stage.stageId !== task.stageId || stage.input !== task.text || stage.sourceLanguage !== task.sourceLanguage || stage.targetLanguage !== task.targetLanguage || stage.contract !== 'passed' || stage.outcome !== 'complete') throw new Error('Contract failure blocks review');
      const result = validateResult(task, stage.candidate);
      if (!result) throw new Error('Invalid evidence result');
      for (const language of new Set([task.sourceLanguage, task.targetLanguage])) {
        const review = stage.humanReview?.[language];
        if (!review || review.reviewer !== reviewers[language] || !Number.isFinite(Date.parse(review.reviewedAt)) || typeof review.notes !== 'string' || !review.notes.trim() || REVIEW_CRITERIA.some(c => review.criteria?.[c] !== 'pass')) throw new Error('Completed human review required');
      }
      task = { ...task, stageId: 'native-rendering', resultKind: 'translation', text: result.text, sourceLanguage: task.command.preferences.activeWritingLanguage, targetLanguage: task.command.preferences.nativeLanguage, recommendationId: result.recommendationId };
    }
  }
  const totals = summary(report);
  if (hash(report.summary) !== hash(totals) || totals.providerAttempts !== plan.plannedCalls || !Number.isSafeInteger(report.apiBudgetMicrousd) || report.apiBudgetMicrousd < plan.maxCostMicrousd || totals.actualCostMicrousd + totals.estimatedCostMicrousd > report.apiBudgetMicrousd) throw new Error('Invalid budget evidence');
  const reviewed = { ...policy, evaluation: { reportId: report.reportId, modelPolicyVersion: policy.model.version, promptVersion: policy.promptVersion, languages: LANGUAGES, contractPassed: true, humanReviewPassed: true } };
  new PolicyRegistry([reviewed], reviewed.version, 'openai');
  return { active: reviewed.version, policies: [reviewed] };
}

async function main() {
  const mode = process.argv.includes('--execute') ? 'execute' : process.argv.includes('--signoff') ? 'signoff' : 'plan';
  const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const policy = await readCandidate(process.env.EVALUATION_POLICY_FILE || 'deployment/policies.openai.candidate.json');
  if (mode === 'plan') { console.info(JSON.stringify({ ...evaluationPlan(policy), paidCalls: 0 }, null, 2)); return; }
  const reportPath = arg('report');
  if (!reportPath) throw new Error('Explicit --report=path required');
  if (mode === 'signoff') {
    const output = arg('output'); if (!output) throw new Error('Explicit --output=path required');
    const config = reviewedConfiguration(JSON.parse(await readFile(reportPath, 'utf8')), policy);
    await writeFile(output, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.info('Reviewed policy exported; no runtime activation performed'); return;
  }
  const budgetMicrousd = parseEvaluationBudget(process.env.EVALUATION_MAX_COST_MICROUSD);
  const automaticReview = process.argv.includes('--automatic-review');
  if (!automaticReview && !process.env.EVALUATION_REVIEWERS_FILE) throw new Error('EVALUATION_REVIEWERS_FILE required');
  const reviewers = automaticReview ? undefined : JSON.parse(await readFile(process.env.EVALUATION_REVIEWERS_FILE, 'utf8'));
  const provider = new OpenAiResponsesAdapter(process.env.OPENAI_API_KEY ?? '');
  const controller = new AbortController(); const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const report = await runEvaluation({ policy, budgetMicrousd, reviewers, automaticReview, reportPath, provider, signal: controller.signal });
    console.info(JSON.stringify({ reportId: report.reportId, state: report.state, ...report.summary, review: automaticReview ? 'automatic-gate-pending' : 'human-review-pending' }));
    if (report.state !== 'completed' || report.summary.contractPassed !== report.plan.plannedCalls) process.exitCode = 1;
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof z.ZodError ? 'Evaluation configuration invalid' : ['EVALUATION_MAX_COST_MICROUSD requires positive integer micro-USD', 'Full evaluation bound exceeds approved budget', 'EVALUATION_REVIEWERS_FILE required', 'Completed human review required'].includes(error.message) ? error.message : 'Evaluation failed; inspect configuration/evidence locally; no automatic retry'); process.exitCode = 1; });
}
