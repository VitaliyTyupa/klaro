import { ErrorCodeSchema, OperationCommandSchema, type FeedbackReason, type OperationCommand, type OperationSnapshot } from '@klaro/contracts';
import type { EditorSession } from './session';

export interface RunPort { execute(command: OperationCommand, signal: AbortSignal, publish: (snapshot: OperationSnapshot) => void): Promise<OperationSnapshot>; submitFeedback?(operationId: string, reason: FeedbackReason, signal: AbortSignal): Promise<void>; }
export interface SchedulerClock { set(callback: () => void, milliseconds: number): unknown; clear(timer: unknown): void; }
const realClock: SchedulerClock = { set: (callback, milliseconds) => setTimeout(callback, milliseconds), clear: timer => clearTimeout(timer as ReturnType<typeof setTimeout>) };
const errorCode = (error: unknown): string => { const parsed = ErrorCodeSchema.safeParse(error instanceof Error ? error.message : undefined); return parsed.success ? parsed.data : 'unavailable'; };

export class EditorScheduler {
  live = false;
  busy = false;
  error: string | undefined;
  nativeError: string | undefined;
  explanationError: string | undefined;
  private timer: unknown;
  private controller: AbortController | undefined;
  private lastSignature: string | undefined;
  private disposed = false;
  private enabled = true;
  private readonly session: EditorSession;
  private readonly port: RunPort;
  private readonly surface: 'web' | 'panel';
  private readonly clock: SchedulerClock;
  private readonly unsubscribe: () => void;
  private readonly unsubscribeRecommendation: () => void;
  private readonly notify: () => void;

  constructor(session: EditorSession, port: RunPort, surface: 'web' | 'panel', clock: SchedulerClock = realClock, notify: () => void = () => {}) {
    this.session = session; this.port = port; this.surface = surface; this.clock = clock; this.notify = notify;
    this.unsubscribe = session.subscribe(() => this.changed());
    this.unsubscribeRecommendation = session.subscribeRecommendation(() => { this.clearTimer(); this.controller?.abort(); this.busy = false; void this.runNative(); });
  }

  setEnabled(enabled: boolean): void { this.enabled = enabled; if (!enabled) this.pause(); }
  setLive(live: boolean): void { if (!this.enabled || this.disposed) return; this.live = live; if (live) this.changed(); else this.pause(); }
  private clearTimer(): void { if (this.timer !== undefined) this.clock.clear(this.timer); this.timer = undefined; }
  private changed(): void {
    this.clearTimer(); this.controller?.abort(); this.busy = false; this.error = undefined; this.nativeError = undefined; this.explanationError = undefined;
    if (this.live && this.enabled && !this.disposed) this.timer = this.clock.set(() => { this.timer = undefined; void this.run(false); }, 1000);
    this.notify();
  }
  pause(): void { this.live = false; this.clearTimer(); this.controller?.abort(); this.busy = false; this.session.invalidateRevision(); this.notify(); }
  async run(force = true, action?: 'paraphrase' | 'alternatives'): Promise<void> {
    if (this.disposed || !this.enabled || this.busy || !this.session.input.trim() || !this.session.withinLimit(this.surface) || this.session.selectionInvalid) return;
    if (action && this.session.mode !== 'correction') return;
    if (action === 'alternatives' && this.session.alternatives?.revisionId === this.session.revisionId) {
      this.session.selectNextAlternative(); this.notify(); return;
    }
    const preferences = structuredClone(this.session.preferences);
    const snapshot = this.session.snapshot();
    const protectedSpans = structuredClone(this.session.protectedSpans);
    const signature = JSON.stringify({ ...snapshot, preferences, protectedSpans, mode: this.session.mode });
    if (!force && signature === this.lastSignature) return;
    const result = this.session.result;
    const parent = action === 'alternatives' && result?.kind === 'correction' && !this.session.resultStale && this.session.recommendationOperationId ? { parent: { operationId: this.session.recommendationOperationId, recommendationId: result.recommendationId }, recommendation: { recommendationId: result.recommendationId, text: result.text } } : {};
    const languages = this.session.mode === 'translation' ? this.session.translationLanguages() : { sourceLanguage: preferences.activeWritingLanguage, targetLanguage: preferences.activeWritingLanguage };
    const command = OperationCommandSchema.parse({ version: 'v1', clientRequestId: crypto.randomUUID(), operationType: action ?? this.session.mode, surface: this.surface, ...snapshot, preferences, ...languages, protectedSpans, ...parent });
    this.lastSignature = signature;
    this.session.rememberOriginal();
    const controller = new AbortController(); this.controller = controller; this.busy = true; this.error = undefined; this.nativeError = undefined; this.notify();
    const publish = (state: OperationSnapshot) => {
      if (controller.signal.aborted || this.disposed || state.revisionId !== this.session.revisionId) return;
      for (const result of state.results) this.session.publish(result, state.operationId);
      if (state.error) { this.error = state.error.code; if (this.session.result?.kind === 'correction' && !this.session.nativeResult) this.nativeError = state.error.code; }
      this.notify();
    };
    try { publish(await this.port.execute(command, controller.signal, publish)); }
    catch (error) { if (!controller.signal.aborted && !this.disposed) { this.error = errorCode(error); if (this.session.result?.kind === 'correction' && !this.session.nativeResult) this.nativeError = this.error; } }
    finally { if (this.controller === controller) { this.busy = false; this.notify(); if (action === 'alternatives' && !controller.signal.aborted && !this.disposed) this.session.selectNextAlternative(); } }
  }

  async runNative(): Promise<void> {
    await this.runRecommendationTask('back-translation');
  }
  async explain(): Promise<void> { if (!this.busy) await this.runRecommendationTask('explanation'); }
  private async runRecommendationTask(operationType: 'back-translation' | 'explanation'): Promise<void> {
    const result = this.session.result;
    const parentId = this.session.recommendationOperationId;
    if (this.disposed || !this.enabled || this.session.resultStale || result?.kind !== 'correction' || !parentId || this.session.mode !== 'correction') return;
    this.clearTimer(); this.controller?.abort();
    const command = OperationCommandSchema.parse({ version: 'v1', clientRequestId: crypto.randomUUID(), operationType, surface: this.surface, ...this.session.snapshot(), preferences: structuredClone(this.session.preferences), sourceLanguage: this.session.preferences.activeWritingLanguage, targetLanguage: this.session.preferences.nativeLanguage, protectedSpans: structuredClone(this.session.protectedSpans), parent: { operationId: parentId, recommendationId: result.recommendationId }, recommendation: { recommendationId: result.recommendationId, text: result.text } });
    const controller = new AbortController(); this.controller = controller; this.busy = true;
    if (operationType === 'back-translation') this.nativeError = undefined; else this.explanationError = undefined;
    this.error = undefined; this.notify();
    const fail = (code: string) => { if (operationType === 'back-translation') this.nativeError = code; else this.explanationError = code; };
    const publish = (state: OperationSnapshot) => {
      if (controller.signal.aborted || this.disposed || command.revisionId !== this.session.revisionId || this.session.result?.kind !== 'correction' || result.recommendationId !== this.session.result.recommendationId) return;
      for (const derived of state.results) if ((operationType === 'back-translation' ? derived.kind === 'translation' : derived.kind === 'explanation') && 'recommendationId' in derived && derived.recommendationId === result.recommendationId) this.session.publish(derived, state.operationId);
      if (state.error) fail(state.error.code);
      this.notify();
    };
    try { publish(await this.port.execute(command, controller.signal, publish)); }
    catch (error) { if (!controller.signal.aborted && !this.disposed) fail(errorCode(error)); }
    finally { if (this.controller === controller) { this.busy = false; this.notify(); } }
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.live = false; this.clearTimer(); this.controller?.abort(); this.unsubscribe(); this.unsubscribeRecommendation(); }
}
