import type { OperationCommand, OperationResult } from '@klaro/contracts';
import type { WorkflowDefinition } from './provider';
import type { PolicyBundle } from './policies';

export function workflowFor(command: OperationCommand, policy?: PolicyBundle): Readonly<WorkflowDefinition> {
  const type = command.operationType;
  const kind: OperationResult['kind'] = ['correction', 'paraphrase'].includes(type) ? 'correction' : type === 'alternatives' ? 'alternatives' : type === 'explanation' ? 'explanation' : ['lexical-supplement', 'source-translation'].includes(type) ? 'lexical' : 'translation';
  const stages = [{ id: type as string, kind }];
  if (kind === 'correction') stages.push({ id: 'native-rendering', kind: 'translation' });
  return Object.freeze({ version: policy?.workflowVersion ?? 'double-workflows-v1', promptVersion: policy?.promptVersion ?? 'language-v1', timeoutMs: 240000, stages: Object.freeze(stages.map(stage => Object.freeze(stage))) });
}
