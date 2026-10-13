import { AcceptedSchema, OperationEventSchema, OperationSnapshotSchema, type Accepted, type OperationEvent, type OperationResult, type OperationSnapshot } from '@klaro/contracts';

export class OperationStream {
  private readonly states = new Map<string, OperationSnapshot>();
  private readonly gaps = new Set<string>();

  accepted(input: Accepted): void {
    const value = AcceptedSchema.parse(input);
    if (!this.states.has(value.operationId)) this.states.set(value.operationId, { version: 'v1', operationId: value.operationId, revisionId: value.revisionId, sequence: 0, status: 'accepted', resultVersion: 0, payloadStatus: 'available', results: [] });
  }

  event(input: OperationEvent): 'applied' | 'duplicate' | 'snapshot-required' {
    const value = OperationEventSchema.parse(input);
    const previous = this.states.get(value.operationId);
    if (!previous || previous.revisionId !== value.revisionId || value.sequence > previous.sequence + 1) { this.gaps.add(value.operationId); return 'snapshot-required'; }
    if (value.sequence <= previous.sequence) return 'duplicate';
    if (this.gaps.has(value.operationId)) return 'snapshot-required';
    this.states.set(value.operationId, { ...previous, sequence: value.sequence, status: value.status, resultVersion: value.resultVersion, results: value.result ? [...previous.results, value.result] : previous.results, ...(value.error ? { error: value.error } : {}) });
    return 'applied';
  }

  snapshot(input: OperationSnapshot): void {
    const value = OperationSnapshotSchema.parse(input);
    const previous = this.states.get(value.operationId);
    if (previous && (previous.revisionId !== value.revisionId || previous.sequence > value.sequence)) return;
    this.states.set(value.operationId, structuredClone(value));
    this.gaps.delete(value.operationId);
  }

  get(operationId: string): OperationSnapshot | undefined { const state = this.states.get(operationId); return state ? structuredClone(state) : undefined; }
  results(operationId: string, revisionId: string): OperationResult[] { const state = this.states.get(operationId); return state?.revisionId === revisionId && state.payloadStatus === 'available' && !this.gaps.has(operationId) ? structuredClone(state.results) : []; }
  clear(): void { this.states.clear(); this.gaps.clear(); }
}
