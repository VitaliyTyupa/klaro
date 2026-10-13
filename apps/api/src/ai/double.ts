import { randomUUID } from 'node:crypto';
import { codePointLength } from '@klaro/contracts';
import type { AiProviderAdapter, AiTask, ProviderResponse } from './provider';

export class DeterministicProvider implements AiProviderAdapter {
  readonly id = 'double';
  readonly attempts: { stageId: string; modelVersion: string }[] = [];
  private readonly delayMs: number;
  private nativeIncomplete: boolean;
  constructor(delayMs = 0, nativeIncompleteOnce = false) { this.delayMs = delayMs; this.nativeIncomplete = nativeIncompleteOnce; }

  async execute(task: AiTask, signal: AbortSignal): Promise<ProviderResponse> {
    this.attempts.push({ stageId: task.stageId, modelVersion: task.policy.version });
    if (this.delayMs) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.delayMs);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Interrupted provider attempt')); }, { once: true });
      if (signal.aborted) { clearTimeout(timer); reject(new Error('Interrupted provider attempt')); }
    });
    if (signal.aborted) throw new Error('Interrupted provider attempt');
    if (this.nativeIncomplete && task.stageId === 'native-rendering') {
      this.nativeIncomplete = false;
      return { candidate: undefined, usage: { inputTokens: Math.max(1, Math.ceil(codePointLength(task.text) / 4)), outputTokens: 0 }, requestId: randomUUID(), outcome: 'incomplete' };
    }
    const revisionId = task.command.revisionId;
    let candidate: unknown;
    if (task.resultKind === 'correction') candidate = { kind: 'correction', revisionId, recommendationId: randomUUID(), text: task.text, editGroups: [], warnings: ['no-changes'] };
    else if (task.resultKind === 'alternatives') candidate = { kind: 'alternatives', revisionId, alternatives: [1, 2, 3].map(() => ({ recommendationId: randomUUID(), text: task.text })), warnings: [] };
    else if (task.resultKind === 'explanation') candidate = { kind: 'explanation', revisionId, recommendationId: task.recommendationId, text: 'Synthetic explanation fixture', warnings: [] };
    else if (task.resultKind === 'lexical') candidate = { kind: 'lexical', revisionId, entryId: task.command.lexical?.entryId, senseId: task.command.lexical?.senseId, section: task.command.lexical?.section, sourceVersion: task.command.lexical?.sourceVersion, text: 'Synthetic lexical fixture', originKind: task.command.operationType === 'source-translation' ? 'machine-translation' : 'generated-unverified', warnings: ['unverified-grammar'] };
    else candidate = { kind: 'translation', revisionId, ...(task.recommendationId ? { recommendationId: task.recommendationId } : {}), text: task.text, warnings: [] };
    if (candidate && typeof candidate === 'object') Object.assign(candidate, { language: task.targetLanguage });
    return { candidate, usage: { inputTokens: Math.max(1, Math.ceil(codePointLength(task.text) / 4)), outputTokens: Math.max(1, Math.ceil(codePointLength(task.text) / 4)) }, requestId: randomUUID(), outcome: 'complete' };
  }
}
