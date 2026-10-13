import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { gateDecision, hash } from './language-judge.mjs';
import { PolicyRegistry } from '../dist/api/ai/policies.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const AcceptanceSchema = z.strictObject({ version: z.literal('initial-policy-acceptance-v1'), accepted: z.literal(true), acceptedBy: identifier, acceptedOn: z.iso.date(), rationale: z.string().trim().min(1).max(2000), sourceDigest: digest, judgeDigest: digest, followUps: z.string().min(1).max(512), followUpsDigest: digest });
export const documentDigest = bytes => createHash('sha256').update(bytes).digest('hex');

export function initialConfiguration(source, judged, input, followUpsBytes, policyVersion) {
  const acceptance = AcceptanceSchema.parse(input);
  // Acceptance preserves machine failures; it never repairs evidence or provider responses.
  const decision = gateDecision(source, judged);
  identifier.parse(policyVersion);
  if (policyVersion === source.policy.version) throw new Error('Initial acceptance requires a new policy version');
  if (acceptance.sourceDigest !== source.evidenceDigest || acceptance.judgeDigest !== judged.digest || acceptance.followUpsDigest !== documentDigest(followUpsBytes)) throw new Error('Acceptance evidence mismatch');
  if (!decision.calibrationPassed) throw new Error('Judge calibration required before initial acceptance');
  const evaluation = { kind: 'initial-acceptance-v1', reportId: source.reportId, modelPolicyVersion: source.policy.model.version, promptVersion: source.policy.promptVersion, languages: ['uk', 'de', 'en', 'vi'], accepted: true, acceptedBy: acceptance.acceptedBy, acceptedOn: acceptance.acceptedOn, rationale: acceptance.rationale, sourcePolicyVersion: source.policy.version, contractPassed: decision.contractPassed, languagePassed: decision.languagePassed, calibrationPassed: true, sourceDigest: source.evidenceDigest, judgeReportId: judged.reportId, judgeDigest: judged.digest, acceptanceDigest: hash(acceptance), followUps: acceptance.followUps, followUpsDigest: acceptance.followUpsDigest };
  const policy = { ...source.policy, version: policyVersion, evaluation };
  new PolicyRegistry([policy], policy.version, 'openai');
  return { active: policy.version, policies: [policy] };
}

async function main() {
  const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const read = async name => { const path = arg(name); if (!path) throw new Error(`Explicit --${name} required`); return JSON.parse(await readFile(path, 'utf8')); };
  const source = await read('source'); const judged = await read('judge'); const acceptance = AcceptanceSchema.parse(await read('acceptance'));
  const output = arg('output'); if (!output) throw new Error('Explicit --output required');
  const configuration = initialConfiguration(source, judged, acceptance, await readFile(acceptance.followUps), arg('policy-version'));
  await writeFile(output, JSON.stringify(configuration, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.info(JSON.stringify({ active: configuration.active, acceptance: configuration.policies[0].evaluation.kind, paidCalls: 0 }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
