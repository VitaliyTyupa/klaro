import { z } from 'zod';
import type { ModelPolicy, PricePolicy } from './provider';
import { DOUBLE_PRICE_POLICY } from './prices';

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const modelSchema = z.strictObject({ version: identifier, provider: z.enum(['double', 'openai']), model: z.string().min(1).max(128), inputTokenLimit: z.number().int().min(1024).max(2000000), outputTokenLimit: z.number().int().min(16).max(16384), timeoutMs: z.number().int().min(1).max(90000), structuredOutputs: z.literal(true) });
const priceSchema = z.strictObject({ version: identifier, inputMicrousdPerMillion: z.number().int().nonnegative(), outputMicrousdPerMillion: z.number().int().nonnegative() });
const evaluationCommon = { reportId: identifier, modelPolicyVersion: identifier, promptVersion: z.enum(['language-v1', 'language-v2', 'language-v3', 'language-v4', 'language-v5']), languages: z.array(z.enum(['uk', 'de', 'en', 'vi'])).length(4) };
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const evaluationSchema = z.union([
  z.strictObject({ ...evaluationCommon, contractPassed: z.literal(true), humanReviewPassed: z.literal(true) }),
  z.strictObject({ ...evaluationCommon, contractPassed: z.literal(true), kind: z.literal('automatic-language-gate-v1'), languagePassed: z.literal(true), calibrationPassed: z.literal(true), disputesResolved: z.literal(true), judgeModel: z.string().min(1).max(128), judgePromptVersion: identifier, sourceDigest: digest, judgeReportId: identifier, judgeDigest: digest, resolutionDigest: digest }),
  z.strictObject({ ...evaluationCommon, kind: z.literal('initial-acceptance-v1'), accepted: z.literal(true), acceptedBy: identifier, acceptedOn: z.iso.date(), rationale: z.string().trim().min(1).max(2000), sourcePolicyVersion: identifier, contractPassed: z.boolean(), languagePassed: z.boolean(), calibrationPassed: z.literal(true), sourceDigest: digest, judgeReportId: identifier, judgeDigest: digest, acceptanceDigest: digest, followUps: z.string().min(1).max(512), followUpsDigest: digest }),
]);
const candidateSchema = z.strictObject({ version: identifier, model: modelSchema, price: priceSchema, workflowVersion: identifier, promptVersion: z.enum(['language-v1', 'language-v2', 'language-v3', 'language-v4', 'language-v5']), evaluation: evaluationSchema.optional() }).superRefine((value, context) => {
  if (value.model.outputTokenLimit > value.model.inputTokenLimit) context.addIssue({ code: 'custom', message: 'Output exceeds input capability' });
  if (value.model.provider === 'double' && (value.price.inputMicrousdPerMillion || value.price.outputMicrousdPerMillion)) context.addIssue({ code: 'custom', message: 'Synthetic provider must be free' });
  if (value.model.provider === 'openai' && (!value.price.inputMicrousdPerMillion || !value.price.outputMicrousdPerMillion)) context.addIssue({ code: 'custom', message: 'Paid provider requires nonzero prices' });
});
const bundleSchema = candidateSchema.superRefine((value, context) => {
  if (value.model.provider === 'openai' && (!value.evaluation || value.evaluation.modelPolicyVersion !== value.model.version || value.evaluation.promptVersion !== value.promptVersion || new Set(value.evaluation.languages).size !== 4)) context.addIssue({ code: 'custom', message: 'Evaluated policy and language quality report required' });
});
// Offline evaluation accepts an unreviewed candidate; runtime activation still requires evidence.
export function parseEvaluationCandidate(value: unknown): PolicyBundle {
  const parsed = candidateSchema.parse(value);
  if (parsed.model.provider !== 'openai') throw new Error('Evaluation requires an OpenAI candidate');
  return parsed;
}
export interface PolicyBundle { readonly version: string; readonly model: Readonly<ModelPolicy>; readonly price: Readonly<PricePolicy>; readonly workflowVersion: string; readonly promptVersion: 'language-v1' | 'language-v2' | 'language-v3' | 'language-v4' | 'language-v5'; }
export const DEFAULT_POLICY: PolicyBundle = Object.freeze({ version: 'double-policy-v5', model: Object.freeze({ version: 'double-v1', provider: 'double', model: 'deterministic', inputTokenLimit: 128000, outputTokenLimit: 16384, timeoutMs: 90000, structuredOutputs: true }), price: DOUBLE_PRICE_POLICY, workflowVersion: 'double-workflows-v1', promptVersion: 'language-v5' });

export class PolicyRegistry {
  private readonly policies = new Map<string, PolicyBundle>();
  private active: string;
  constructor(values: readonly unknown[] = [DEFAULT_POLICY], active = DEFAULT_POLICY.version, readonly providerId = 'double') {
    for (const input of values) {
      const value = bundleSchema.parse(input);
      if (value.model.provider !== providerId || this.policies.has(value.version)) throw new Error('Incompatible or duplicate model policy');
      this.policies.set(value.version, Object.freeze({ ...value, model: Object.freeze(value.model), price: Object.freeze(value.price) }));
    }
    this.active = active;
    this.current();
  }
  current(): PolicyBundle { const policy = this.policies.get(this.active); if (!policy) throw new Error('Unknown active policy'); return policy; }
  activate(version: string): void { if (!this.policies.has(version)) throw new Error('Unknown policy'); this.active = version; }
}
