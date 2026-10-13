import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initialConfiguration, documentDigest } from '../tools/accept-initial-policy.mjs';
import { PolicyRegistry } from '../dist/api/ai/policies.js';
const source = JSON.parse(await readFile('docs/evaluations/openai-run-v1.json', 'utf8'));
const judged = JSON.parse(await readFile('docs/evaluations/openai-judge-v1.json', 'utf8'));
const followUps = Buffer.from('Synthetic follow-ups');
const acceptance = { version: 'initial-policy-acceptance-v1', accepted: true, acceptedBy: 'project-owner', acceptedOn: '2026-10-13', rationale: 'Accepted initial result with deferred findings', sourceDigest: source.evidenceDigest, judgeDigest: judged.digest, followUps: 'docs/evaluations/initial-acceptance-and-follow-ups.md', followUpsDigest: documentDigest(followUps) };

test('explicit acceptance permits activation while retaining failures and evidence integrity', () => {
  const original = JSON.stringify([source, judged]);
  const config = initialConfiguration(source, judged, acceptance, followUps, 'accepted-policy-v1');
  const evaluation = config.policies[0].evaluation;
  assert.equal(evaluation.contractPassed, false); assert.equal(evaluation.languagePassed, false);
  assert.equal(evaluation.humanReviewPassed, undefined); assert.equal(evaluation.kind, 'initial-acceptance-v1');
  assert.equal(new PolicyRegistry(config.policies, config.active, 'openai').current().version, config.active);
  assert.equal(JSON.stringify([source, judged]), original);
  for (const invalid of [{ ...acceptance, accepted: false }, { ...acceptance, sourceDigest: '0'.repeat(64) }, { ...acceptance, judgeDigest: '0'.repeat(64) }]) assert.throws(() => initialConfiguration(source, judged, invalid, followUps, 'accepted-policy-v1'));
  assert.throws(() => initialConfiguration(source, judged, acceptance, Buffer.from('Changed backlog'), 'accepted-policy-v1'));
  assert.throws(() => initialConfiguration(source, judged, acceptance, followUps, source.policy.version));
  const changed = structuredClone(source); changed.cases[0].stages[0].candidate.text += 'changed';
  assert.throws(() => initialConfiguration(changed, judged, acceptance, followUps, 'accepted-policy-v1'));
  const mismatched = structuredClone(config.policies[0]); mismatched.promptVersion = 'language-v4';
  assert.throws(() => new PolicyRegistry([mismatched], config.active, 'openai'));
  for (const mutation of [{ accepted: false }, { calibrationPassed: false }, { acceptanceDigest: 'invalid' }, { humanReviewPassed: true }]) assert.throws(() => new PolicyRegistry([{ ...config.policies[0], evaluation: { ...evaluation, ...mutation } }], config.active, 'openai'));
});
