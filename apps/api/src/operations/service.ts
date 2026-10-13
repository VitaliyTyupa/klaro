import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';
import { AcceptedSchema, OperationCommandSchema, OperationEventSchema, OperationSnapshotSchema, PreferencesSchema, codePointLength, type Accepted, type OperationCommand, type OperationEvent, type OperationResult, type OperationSnapshot, type OperationStatus, type StructuredError } from '@klaro/contracts';
import type { AuthenticatedSession } from '../identity/sessions';
import { ProviderFailure, type AiProviderAdapter, type AiTask } from '../ai/provider';
import { ApplicationError } from './errors';
import { PayloadStore } from './payloads';
import { BudgetService, type StageBound } from './budgets';
import { usageCost } from '../ai/prices';
import { workflowFor } from '../ai/workflows';
import { PolicyRegistry, type PolicyBundle } from '../ai/policies';
import { validateResult } from '../ai/result-validation';
import { SupplementService } from '../reference/supplements';
import { inputTokenUpperBound } from '../ai/task';

interface OperationRow {
  id: string;
  user_id: string;
  revision_id: string;
  status: OperationStatus;
  last_sequence: string;
  result_version: number;
  payload_digest: Buffer | null;
  payload_expires_at: Date;
  cancel_requested_at: Date | null;
  error_code: StructuredError['code'] | null;
  error_retryable: boolean;
}
interface Settings {
  databaseUrl: string;
  payloads: PayloadStore;
  hmacKey?: string;
  provider?: AiProviderAdapter;
  budgets?: BudgetService;
  policies?: PolicyRegistry;
  enabled?: () => Promise<boolean>;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}

export class OperationApplicationService {
  private readonly pool: pg.Pool;
  private readonly accepting = new Map<string, Promise<Accepted>>();
  private readonly running = new Map<string, AbortController>();
  private readonly listeners = new Set<(userId: string, event: OperationEvent) => void>();
  private readonly budgets: BudgetService;
  private readonly pendingRuns = new Set<Promise<void>>();
  private readonly policies: PolicyRegistry;
  private readonly supplements: SupplementService;
  policyKey(preferences: Pick<OperationCommand['preferences'], 'style' | 'proficiency'> = { style: 'neutral', proficiency: null }, policy = this.policies.current()): string { return `${policy.model.version}:${policy.promptVersion}:${policy.workflowVersion}:${preferences.style}:${preferences.proficiency ?? ''}`; }
  private bound(policy: PolicyBundle): StageBound { return { inputTokens: policy.model.inputTokenLimit, outputTokens: policy.model.outputTokenLimit, costMicrousd: usageCost(policy.price, policy.model.inputTokenLimit, policy.model.outputTokenLimit) }; }

  constructor(private readonly settings: Settings) { this.pool = new pg.Pool({ connectionString: settings.databaseUrl, max: 10 }); this.supplements = new SupplementService(settings.databaseUrl); this.budgets = settings.budgets ?? new BudgetService(); this.policies = settings.policies ?? new PolicyRegistry(); if (settings.provider && settings.provider.id !== this.policies.providerId) throw new Error('Provider policy mismatch'); }
  private async transaction<T>(action: (connection: pg.PoolClient) => Promise<T>): Promise<T> {
    const connection = await this.pool.connect();
    try { await connection.query('BEGIN'); const value = await action(connection); await connection.query('COMMIT'); return value; }
    catch (error) { await connection.query('ROLLBACK'); throw error; }
    finally { connection.release(); }
  }
  subscribe(listener: (userId: string, event: OperationEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  private digest(userId: string, command: OperationCommand): Buffer {
    if (!this.settings.hmacKey || !/^[a-fA-F0-9]{64}$/.test(this.settings.hmacKey)) throw new ApplicationError('unavailable');
    return createHmac('sha256', Buffer.from(this.settings.hmacKey, 'hex')).update(`${userId}:${canonical(command)}`).digest();
  }

  private acknowledgement(row: OperationRow): Accepted {
    return AcceptedSchema.parse({ version: 'v1', operationId: row.id, revisionId: row.revision_id, sequence: 0, status: 'accepted', resourceUrl: `/v1/operations/${row.id}` });
  }

  async accept(actor: AuthenticatedSession, input: unknown): Promise<Accepted> {
    if (this.settings.enabled && !await this.settings.enabled()) throw new ApplicationError('unavailable', false);
    const parsed = OperationCommandSchema.safeParse(input);
    if (!parsed.success) throw new ApplicationError('invalid-request');
    const identity = await this.pool.query("SELECT s.id FROM klaro.sessions s JOIN klaro.users u ON u.id = s.user_id WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'", [actor.sessionId, actor.userId]);
    if (!identity.rowCount) throw new ApplicationError('unauthenticated');
    const command = parsed.data;
    if (command.surface !== (actor.clientKind === 'web' ? 'web' : 'panel')) throw new ApplicationError('invalid-request');
    const fingerprint = this.digest(actor.userId, command);
    const key = `${actor.userId}:${command.clientRequestId}`;
    const pending = this.accepting.get(key);
    if (pending) { await pending; return this.accept(actor, command); }
    const acceptance = this.acceptNew(actor, command, fingerprint);
    this.accepting.set(key, acceptance);
    try { return await acceptance; }
    finally { this.accepting.delete(key); }
  }

  private async acceptNew(actor: AuthenticatedSession, command: OperationCommand, fingerprint: Buffer): Promise<Accepted> {
    const existing = await this.pool.query<OperationRow>('SELECT * FROM klaro.operations WHERE user_id = $1 AND client_request_id = $2', [actor.userId, command.clientRequestId]);
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (!row.payload_digest) throw new ApplicationError('payload-expired');
      if (row.payload_digest && !timingSafeEqual(row.payload_digest, fingerprint)) throw new ApplicationError('conflict');
      if (!(await this.settings.payloads.get(actor.userId, row.id))) throw new ApplicationError('payload-expired');
      return this.acknowledgement(row);
    }
    command = await this.supplements.prepare(command);
    if (!OperationCommandSchema.safeParse(command).success) throw new ApplicationError('input-too-large');
    if (!this.settings.provider) throw new ApplicationError('unavailable');
    const policy = this.policies.current();
    const source = command.selection.scope === 'selection' ? command.input.slice(command.selection.start, command.selection.end) : command.input;
    const firstStage = workflowFor(command, policy).stages[0]!;
    if (inputTokenUpperBound({ command, stageId: firstStage.id, resultKind: firstStage.kind, text: command.operationType === 'back-translation' ? command.recommendation!.text : source, sourceLanguage: command.sourceLanguage, targetLanguage: command.targetLanguage, policy: policy.model, promptVersion: policy.promptVersion }) > policy.model.inputTokenLimit) throw new ApplicationError('input-too-large');
    const connection = await this.pool.connect();
    let row: OperationRow;
    try {
      await connection.query('BEGIN');
      const session = await connection.query("SELECT s.id FROM klaro.sessions s JOIN klaro.users u ON u.id = s.user_id WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active' FOR SHARE OF s, u", [actor.sessionId, actor.userId]);
      if (!session.rowCount) throw new ApplicationError('unauthenticated');
      const preferenceRow = await connection.query('SELECT * FROM klaro.user_preferences WHERE user_id = $1 FOR SHARE', [actor.userId]);
      const preference = preferenceRow.rows[0];
      if (!preference) throw new ApplicationError('unauthenticated');
      const stored = PreferencesSchema.parse({ version: 'v1', nativeLanguage: preference.native_language, writingLanguages: preference.writing_languages, activeWritingLanguage: preference.active_writing_language, style: preference.style, proficiency: preference.proficiency });
      if (canonical(stored) !== canonical(command.preferences)) throw new ApplicationError('conflict');
      if (command.parent) {
        if (!z.uuid().safeParse(command.parent.operationId).success) throw new ApplicationError('invalid-request');
        const parent = await connection.query('SELECT id FROM klaro.operations WHERE id = $1 AND user_id = $2', [command.parent.operationId, actor.userId]);
        if (!parent.rowCount) throw new ApplicationError('forbidden');
      }
      const inserted = await connection.query<OperationRow>("INSERT INTO klaro.operations (id, user_id, client_request_id, revision_id, operation_type, payload_digest, digest_expires_at, payload_expires_at, workflow_version, model_policy_version, prompt_policy_version, input_code_points, parent_operation_id) VALUES ($1, $2, $3, $4, $5, $6, now() + interval '24 hours', now() + interval '30 minutes', $9, $10, $11, $7, $8) RETURNING *", [randomUUID(), actor.userId, command.clientRequestId, command.revisionId, command.operationType, fingerprint, codePointLength(command.input), command.parent?.operationId ?? null, policy.workflowVersion, policy.model.version, policy.promptVersion]);
      row = inserted.rows[0]!;
      await this.budgets.reserve(connection, actor.userId, row.id, this.bound(policy), workflowFor(command, policy).stages.length, policy.price.version);
      await this.settings.payloads.create(actor.userId, row.id, command);
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally { connection.release(); }
    this.emit(actor.userId, { version: 'v1', operationId: row.id, revisionId: row.revision_id, sequence: 0, status: 'accepted', event: 'operation.accepted', stageId: null, resultVersion: 0 });
    queueMicrotask(() => {
      const run = this.run(actor, row.id, command, policy).catch(() => {});
      this.pendingRuns.add(run);
      void run.finally(() => this.pendingRuns.delete(run));
    });
    return this.acknowledgement(row);
  }

  private emit(userId: string, event: OperationEvent): void {
    const value = OperationEventSchema.parse(event);
    for (const listener of this.listeners) { try { listener(userId, value); } catch { /* A transport cannot interrupt domain execution. */ } }
  }

  private async event(userId: string, operationId: string, status: OperationStatus, event: OperationEvent['event'], stageId: string | null, result?: OperationResult, error?: StructuredError, terminal = false): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const active = await connection.query("SELECT id FROM klaro.users WHERE id = $1 AND status = 'active' FOR SHARE", [userId]);
      if (!active.rowCount) throw new ApplicationError('unauthenticated');
      const selected = await connection.query<OperationRow>('SELECT * FROM klaro.operations WHERE id = $1 AND user_id = $2 FOR UPDATE', [operationId, userId]);
      const previous = selected.rows[0];
      if (!previous) throw new ApplicationError('forbidden');
      const sequence = Number(previous.last_sequence) + 1;
      const resultVersion = previous.result_version + (result ? 1 : 0);
      const payload = await this.settings.payloads.get(userId, operationId);
      if (payload) {
        payload.sequence = sequence;
        if (result) payload.results.push(result);
        if (error) payload.error = error;
        await this.settings.payloads.update(userId, operationId, payload, terminal);
      } else if (result) throw new ApplicationError('payload-expired');
      await connection.query('UPDATE klaro.operations SET status = $3, last_sequence = $4, result_version = $5, error_code = $6, error_retryable = $7, updated_at = now(), completed_at = CASE WHEN $8 THEN now() ELSE completed_at END WHERE id = $1 AND user_id = $2', [operationId, userId, status, sequence, resultVersion, error?.code ?? null, error?.retryable ?? false, terminal]);
      await connection.query('COMMIT');
      this.emit(userId, { version: 'v1', operationId, revisionId: previous.revision_id, sequence, status, event, stageId, resultVersion, ...(result ? { result } : {}), ...(error ? { error } : {}) });
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally { connection.release(); }
  }

  private async authorizedStage(actor: AuthenticatedSession, operationId: string): Promise<void> {
    const result = await this.pool.query("SELECT o.cancel_requested_at FROM klaro.operations o JOIN klaro.users u ON u.id = o.user_id JOIN klaro.sessions s ON s.user_id = u.id WHERE o.id = $1 AND o.user_id = $2 AND s.id = $3 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'", [operationId, actor.userId, actor.sessionId]);
    if (!result.rows[0]) throw new ApplicationError('unauthenticated');
    if (result.rows[0].cancel_requested_at) throw new ApplicationError('cancelled');
  }

  private async run(actor: AuthenticatedSession, operationId: string, command: OperationCommand, policy: PolicyBundle): Promise<void> {
    const modelPolicy = policy.model;
    const stageBound = this.bound(policy);
    const controller = new AbortController();
    this.running.set(operationId, controller);
    let published = 0;
    try {
      const source = command.selection.scope === 'selection' ? command.input.slice(command.selection.start, command.selection.end) : command.input;
      const workflow = workflowFor(command, policy);
      const workflowSignal = AbortSignal.timeout(workflow.timeoutMs);
      let text = command.operationType === 'back-translation' ? command.recommendation!.text : source;
      let recommendationId = command.recommendation?.recommendationId;
      for (const stage of workflow.stages) {
        await this.authorizedStage(actor, operationId);
        const task: AiTask = { command, stageId: stage.id, resultKind: stage.kind, text, sourceLanguage: command.sourceLanguage, targetLanguage: stage.id === 'native-rendering' ? command.preferences.nativeLanguage : command.targetLanguage, recommendationId, policy: modelPolicy, promptVersion: policy.promptVersion };
        if (inputTokenUpperBound(task) > modelPolicy.inputTokenLimit) throw new ApplicationError('input-too-large');
        const attemptId = randomUUID();
        await this.pool.query("INSERT INTO klaro.stage_attempts (id, operation_id, user_id, stage_id, attempt_number, status, model_policy_version, prompt_policy_version, input_token_bound, output_token_bound, cost_bound_microusd) VALUES ($1, $2, $3, $4, 1, 'prepared', $8, $9, $5, $6, $7)", [attemptId, operationId, actor.userId, stage.id, stageBound.inputTokens, stageBound.outputTokens, stageBound.costMicrousd, policy.model.version, policy.promptVersion]);
        await this.event(actor.userId, operationId, 'running', 'stage.started', stage.id);
        await this.authorizedStage(actor, operationId);
        await this.transaction(async connection => {
          const enabled = await connection.query('SELECT ai_enabled FROM klaro.operational_controls WHERE singleton FOR SHARE');
          if (enabled.rows[0]?.ai_enabled !== true) throw new ApplicationError('unavailable', false);
          await this.budgets.beforeDispatch(connection, operationId, stageBound);
          await connection.query("UPDATE klaro.stage_attempts SET status = 'dispatched', dispatched_at = now() WHERE id = $1", [attemptId]);
        });
        let response;
        try {
          const signal = AbortSignal.any([controller.signal, workflowSignal, AbortSignal.timeout(modelPolicy.timeoutMs)]);
          response = await new Promise<Awaited<ReturnType<AiProviderAdapter['execute']>>>((resolve, reject) => {
            const abort = () => reject(new Error('Interrupted attempt'));
            signal.addEventListener('abort', abort, { once: true });
            this.settings.provider!.execute(task, signal).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
            if (signal.aborted) abort();
          });
        } catch (error) {
          await this.pool.query("UPDATE klaro.stage_attempts SET status = 'indeterminate', error_code = 'indeterminate', completed_at = now() WHERE id = $1", [attemptId]);
          throw new ApplicationError(controller.signal.aborted ? 'cancelled' : error instanceof ProviderFailure ? error.code : 'indeterminate');
        }
        if (response.usage) {
          const usage = response.usage;
          if (!Number.isSafeInteger(usage.inputTokens) || !Number.isSafeInteger(usage.outputTokens) || usage.inputTokens < 0 || usage.outputTokens < 0) throw new ApplicationError('invalid-result');
          await this.transaction(connection => this.budgets.settle(connection, attemptId, usage.inputTokens, usage.outputTokens, usageCost(policy.price, usage.inputTokens, usage.outputTokens), 'actual'));
        }
        if (response.outcome !== 'complete') throw new ApplicationError(response.outcome === 'refusal' ? 'provider-refusal' : 'provider-incomplete');
        const result = validateResult(task, response.candidate);
        if (!result) throw new ApplicationError('invalid-result');
        await this.authorizedStage(actor, operationId);
        await this.pool.query("UPDATE klaro.stage_attempts SET status = 'completed', completed_at = now(), provider_request_id = $2 WHERE id = $1", [attemptId, response.requestId?.slice(0, 256) ?? null]);
        await this.event(actor.userId, operationId, 'partially-completed', 'stage.completed', stage.id, result);
        await this.supplements.store(command, result, this.policyKey(command.preferences, policy)).catch(() => {});
        published++;
        if (result.kind === 'correction') { text = result.text; recommendationId = result.recommendationId; }
      }
      await this.event(actor.userId, operationId, 'completed', 'operation.completed', null, undefined, undefined, true);
    } catch (error) {
      const detail = error instanceof ApplicationError ? error.detail : { code: 'unavailable' as const, retryable: true };
      await this.pool.query("UPDATE klaro.stage_attempts a SET status = CASE WHEN a.dispatched_at IS NULL THEN $2 WHEN EXISTS (SELECT 1 FROM klaro.usage_ledger l WHERE l.stage_attempt_id = a.id) THEN $2 ELSE 'indeterminate' END, completed_at = now(), error_code = $3 WHERE operation_id = $1 AND status IN ('prepared', 'dispatched')", [operationId, detail.code === 'cancelled' ? 'cancelled' : 'failed', detail.code]).catch(() => {});
      const status = detail.code === 'cancelled' ? 'cancelled' : published ? 'partially-completed' : detail.code === 'indeterminate' ? 'indeterminate' : 'failed';
      await this.event(actor.userId, operationId, status, status === 'cancelled' ? 'operation.cancelled' : 'operation.failed', null, undefined, detail, true).catch(() => {});
    } finally {
      await this.transaction(connection => this.budgets.finish(connection, operationId)).catch(() => {});
      this.running.delete(operationId);
    }
  }

  async snapshot(actor: AuthenticatedSession, operationId: string): Promise<OperationSnapshot> {
    if (!z.uuid().safeParse(operationId).success) throw new ApplicationError('invalid-request');
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const active = await connection.query("SELECT id FROM klaro.users WHERE id = $1 AND status = 'active' FOR SHARE", [actor.userId]);
      if (!active.rowCount) throw new ApplicationError('unauthenticated');
      const session = await connection.query('SELECT id FROM klaro.sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()', [actor.sessionId, actor.userId]);
      if (!session.rowCount) throw new ApplicationError('unauthenticated');
      const selected = await connection.query<OperationRow>('SELECT * FROM klaro.operations WHERE id = $1 AND user_id = $2 FOR SHARE', [operationId, actor.userId]);
      const row = selected.rows[0];
      if (!row) throw new ApplicationError('forbidden');
      const payload = await this.settings.payloads.get(actor.userId, operationId);
      const available = payload !== undefined && payload.sequence === Number(row.last_sequence);
      await connection.query('COMMIT');
      return OperationSnapshotSchema.parse({ version: 'v1', operationId, revisionId: row.revision_id, sequence: Number(row.last_sequence), status: row.status, resultVersion: row.result_version, payloadStatus: available ? 'available' : 'expired', results: available ? payload.results : [], ...(row.error_code ? { error: { code: row.error_code, retryable: row.error_retryable } } : {}) });
    } catch (error) { await connection.query('ROLLBACK'); throw error; }
    finally { connection.release(); }
  }

  async cancel(actor: AuthenticatedSession, operationId: string): Promise<OperationSnapshot> {
    if (!z.uuid().safeParse(operationId).success) throw new ApplicationError('invalid-request');
    const result = await this.pool.query("UPDATE klaro.operations SET cancel_requested_at = now() WHERE id = $1 AND user_id = $2 AND completed_at IS NULL RETURNING id", [operationId, actor.userId]);
    if (result.rowCount) this.running.get(operationId)?.abort();
    return this.snapshot(actor, operationId);
  }

  async recover(): Promise<void> {
    const unfinished = await this.pool.query<OperationRow>('SELECT * FROM klaro.operations WHERE completed_at IS NULL ORDER BY created_at');
    for (const operation of unfinished.rows) {
      const attempts = await this.pool.query('SELECT id FROM klaro.stage_attempts WHERE operation_id = $1 AND dispatched_at IS NOT NULL', [operation.id]);
      const status = operation.result_version > 0 ? 'partially-completed' : attempts.rowCount ? 'indeterminate' : 'cancelled';
      await this.pool.query("UPDATE klaro.stage_attempts SET status = CASE WHEN dispatched_at IS NULL THEN 'cancelled' ELSE 'indeterminate' END, completed_at = now(), error_code = 'indeterminate' WHERE operation_id = $1 AND status IN ('prepared', 'dispatched')", [operation.id]);
      await this.event(operation.user_id, operation.id, status, status === 'cancelled' ? 'operation.cancelled' : 'operation.failed', null, undefined, { code: attempts.rowCount ? 'indeterminate' : 'cancelled', retryable: false }, true);
      await this.transaction(connection => this.budgets.finish(connection, operation.id));
    }
    await this.transaction(connection => this.budgets.reconcile(connection));
  }

  async reconcile(): Promise<void> { await this.transaction(connection => this.budgets.reconcile(connection)); }

  async deliverIfActive(actor: AuthenticatedSession, deliver: () => void): Promise<void> {
    await this.transaction(async connection => {
      const user = await connection.query("SELECT id FROM klaro.users WHERE id = $1 AND status = 'active' FOR SHARE", [actor.userId]);
      const session = await connection.query('SELECT id FROM klaro.sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now() FOR SHARE', [actor.sessionId, actor.userId]);
      if (!user.rowCount || !session.rowCount) throw new ApplicationError('unauthenticated');
      deliver();
    });
  }

  async abortUser(userId: string): Promise<void> {
    const rows = await this.pool.query('SELECT id FROM klaro.operations WHERE user_id = $1', [userId]);
    for (const row of rows.rows) this.running.get(row.id)?.abort();
  }

  async close(): Promise<void> { for (const controller of this.running.values()) controller.abort(); await Promise.allSettled([...this.pendingRuns]); await this.supplements.close(); await this.pool.end(); await this.settings.payloads.close(); }
}
