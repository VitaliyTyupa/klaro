import type { OperationCommand, OperationResult } from '@klaro/contracts';

export class ProviderFailure extends Error {
  readonly code: 'provider-error' | 'indeterminate' | 'invalid-result';
  constructor(code: 'provider-error' | 'indeterminate' | 'invalid-result') { super(code); this.code = code; }
}

export interface ModelPolicy {
  version: string;
  provider: string;
  model: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  timeoutMs: number;
  structuredOutputs: boolean;
}
export interface PricePolicy {
  version: string;
  inputMicrousdPerMillion: number;
  outputMicrousdPerMillion: number;
}
export interface AiTask {
  command: OperationCommand;
  stageId: string;
  resultKind: OperationResult['kind'];
  text: string;
  sourceLanguage: OperationCommand['sourceLanguage'];
  targetLanguage: OperationCommand['targetLanguage'];
  recommendationId?: string;
  policy: ModelPolicy;
  promptVersion?: 'language-v1' | 'language-v2' | 'language-v3' | 'language-v4' | 'language-v5';
}
export interface ProviderResponse {
  candidate: unknown;
  usage?: { inputTokens: number; outputTokens: number };
  requestId?: string;
  outcome: 'complete' | 'refusal' | 'incomplete';
}
export interface AiProviderAdapter {
  readonly id: string;
  execute(task: AiTask, signal: AbortSignal): Promise<ProviderResponse>;
}
export interface WorkflowDefinition {
  version: string;
  promptVersion: string;
  timeoutMs: number;
  stages: readonly { id: string; kind: OperationResult['kind'] }[];
}
