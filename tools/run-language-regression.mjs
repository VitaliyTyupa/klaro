import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { DEFAULT_PREFERENCES, OperationCommandSchema } from '@klaro/contracts';
import { DeterministicProvider } from '../dist/api/ai/double.js';
import { DEFAULT_POLICY } from '../dist/api/ai/policies.js';
import { validateResult } from '../dist/api/ai/result-validation.js';
const fixtures = JSON.parse(await readFile('packages/testing/fixtures/language-regression.json', 'utf8'));
assert.equal(fixtures.origin, 'synthetic');
const provider = new DeterministicProvider();
const cases = [];
for (const fixture of fixtures.cases) {
  const nativeLanguage = fixture.language === 'uk' ? 'de' : 'uk';
  const preferences = { ...DEFAULT_PREFERENCES, nativeLanguage, writingLanguages: [fixture.language], activeWritingLanguage: fixture.language, style: fixture.style, proficiency: fixture.proficiency };
  const protectedSpans = fixture.protectedTerms.map(term => ({ start: fixture.input.indexOf(term), end: fixture.input.indexOf(term) + term.length }));
  const command = OperationCommandSchema.parse({ version: 'v1', clientRequestId: fixture.id, revisionId: fixture.id, operationType: 'correction', surface: 'web', input: fixture.input, selection: { scope: 'document' }, preferences, sourceLanguage: fixture.language, targetLanguage: fixture.language, protectedSpans });
  const task = { command, stageId: 'correction', resultKind: 'correction', text: fixture.input, sourceLanguage: fixture.language, targetLanguage: fixture.language, policy: DEFAULT_POLICY.model, promptVersion: DEFAULT_POLICY.promptVersion };
  const response = await provider.execute(task, new AbortController().signal);
  const result = validateResult(task, response.candidate);
  assert.ok(result); assert.equal(result.text, fixture.input);
  assert.ok(fixture.numbers.every(number => result.text.includes(number)));
  assert.ok(fixture.protectedTerms.every(term => result.text.includes(term)));
  cases.push({ caseId: fixture.id, language: fixture.language, input: fixture.input, output: result.text, contract: 'passed', automatedIndicators: { numbersPresent: true, protectedTermsPresent: true }, humanReview: Object.fromEntries(fixture.reviewCriteria.map(criterion => [criterion, 'pending'])), reviewer: null, notes: null });
}
assert.equal(cases.length, 12);
const report = { version: 'v1', fixtureVersion: fixtures.version, modelPolicyVersion: DEFAULT_POLICY.model.version, promptVersion: DEFAULT_POLICY.promptVersion, provider: 'double', realModelEvaluation: false, languageReadiness: 'unreviewed', apiBudgetMicrousd: 0, createdAt: new Date().toISOString(), summary: { cases: cases.length, contractPassed: cases.length, humanReviewPassed: false }, cases };
await writeFile('docs/evaluations/double-regression.json', JSON.stringify(report, null, 2) + '\n');
console.info('Synthetic regression: 12 contract fixtures passed; language quality and human review remain pending');
