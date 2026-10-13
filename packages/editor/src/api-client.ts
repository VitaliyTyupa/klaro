import { AcceptedSchema, OperationEventSchema, OperationFeedbackSchema, OperationSnapshotSchema, StructuredErrorSchema, type FeedbackReason, type OperationCommand, type OperationSnapshot } from '@klaro/contracts';
import type { RunPort } from './scheduler';

export interface OperationSocket {
  on(event: string, listener: (...args: unknown[]) => void): OperationSocket;
  removeAllListeners(): OperationSocket;
  connect(): OperationSocket;
  disconnect(): OperationSocket;
}
export type OperationSocketFactory = (origin: string, auth: { token?: string; csrfToken?: string }) => Promise<OperationSocket>;
const browserSocket: OperationSocketFactory = async (origin, auth) => {
  const { io } = await import('socket.io-client');
  return io(`${origin}/v1/operations`, { auth, transports: ['websocket'], withCredentials: !origin, autoConnect: false, forceNew: true, reconnectionAttempts: 5, timeout: 5000, closeOnBeforeunload: true });
};

export class ApiOperationClient implements RunPort {
  private readonly origin: string;
  private readonly headers: () => Record<string, string>;
  private readonly request: typeof fetch;
  private readonly socketFactory: OperationSocketFactory;
  private lifetime = new AbortController();
  private disposed = false;
  authorize: ((signal: AbortSignal) => Promise<void>) | undefined;
  constructor(origin: string, headers: () => Record<string, string>, request: typeof fetch = (input, init) => fetch(input, init), socketFactory: OperationSocketFactory = browserSocket) { this.origin = origin; this.headers = headers; this.request = request; this.socketFactory = socketFactory; }

  suspend(): void { this.lifetime.abort(); if (!this.disposed) this.lifetime = new AbortController(); }
  dispose(): void { this.disposed = true; this.suspend(); }

  async submitFeedback(operationId: string, reason: FeedbackReason, signal: AbortSignal): Promise<void> {
    if (this.disposed || !/^[a-f0-9-]{36}$/i.test(operationId)) throw new Error('Closed or invalid feedback client');
    const bounded = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(10000)]);
    bounded.throwIfAborted();
    const value = await this.json(`/${operationId}/feedback`, bounded, OperationFeedbackSchema.parse({ reason }));
    if (!value || typeof value !== 'object' || !('received' in value) || value.received !== true) throw new Error('unavailable');
  }

  private async json(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const response = await this.request(`${this.origin}/v1/operations${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...this.headers(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal, credentials: this.origin ? 'omit' : 'same-origin', cache: 'no-store' });
    const value: unknown = await response.json();
    if (!response.ok) { const detail = StructuredErrorSchema.safeParse(value); throw new Error(detail.success ? detail.data.code : 'unavailable'); }
    return value;
  }

  async execute(command: OperationCommand, signal: AbortSignal, publish: (snapshot: OperationSnapshot) => void): Promise<OperationSnapshot> {
    if (this.disposed) throw new Error('Closed operation client');
    const bounded = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(245000)]);
    bounded.throwIfAborted();
    await this.authorize?.(bounded);
    bounded.throwIfAborted();
    const accepted = AcceptedSchema.parse(await this.json('', bounded, command));
    if (accepted.revisionId !== command.revisionId) throw new Error('Invalid acknowledgement');
    const cancel = () => { void this.request(`${this.origin}/v1/operations/${accepted.operationId}/cancel`, { method: 'POST', headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: '{}', credentials: this.origin ? 'omit' : 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(3000) }).catch(() => {}); };
    bounded.addEventListener('abort', cancel, { once: true });
    if (bounded.aborted) { cancel(); throw new Error('Interrupted operation'); }
    let socket: OperationSocket | undefined;
    let latest: OperationSnapshot | undefined;
    let refresh: Promise<void> | undefined;
    const deliver = (state: OperationSnapshot) => {
      if (bounded.aborted || state.operationId !== accepted.operationId || state.revisionId !== command.revisionId) return;
      if (latest && state.sequence < latest.sequence) return;
      latest = state; publish(state);
    };
    const refreshSnapshot = () => {
      if (bounded.aborted || refresh) return;
      refresh = this.json(`/${accepted.operationId}`, bounded).then(value => deliver(OperationSnapshotSchema.parse(value))).catch(() => {}).finally(() => { refresh = undefined; });
    };
    try {
      const headers = this.headers();
      // Browser WebSockets cannot set Authorization headers; credentials are handshake data.
      socket = await this.socketFactory(this.origin, { ...(headers['Authorization']?.startsWith('Bearer ') ? { token: headers['Authorization'].slice(7) } : {}), ...(headers['X-CSRF-Token'] || headers['x-csrf-token'] ? { csrfToken: headers['X-CSRF-Token'] ?? headers['x-csrf-token'] } : {}) });
      if (bounded.aborted) throw new Error('Interrupted operation');
      socket.on('connect', refreshSnapshot);
      socket.on('operation.event', value => {
        if (bounded.aborted) return;
        const parsed = OperationEventSchema.safeParse(value);
        if (!parsed.success || parsed.data.operationId !== accepted.operationId || parsed.data.revisionId !== command.revisionId) return;
        const event = parsed.data;
        if (!latest || event.sequence > latest.sequence + 1) { refreshSnapshot(); return; }
        if (event.sequence <= latest.sequence) return;
        deliver({ ...latest, sequence: event.sequence, status: event.status, resultVersion: event.resultVersion, results: event.result ? [...latest.results, event.result] : latest.results, ...(event.error ? { error: event.error } : {}) });
      });
      const disconnect = () => { socket?.removeAllListeners(); socket?.disconnect(); };
      bounded.addEventListener('abort', disconnect, { once: true });
      socket.connect();
      try {
      while (true) {
        bounded.throwIfAborted();
        const state = OperationSnapshotSchema.parse(await this.json(`/${accepted.operationId}`, bounded));
        if (state.operationId !== accepted.operationId || state.revisionId !== command.revisionId) throw new Error('Invalid snapshot correlation');
        deliver(state);
        const current = latest ?? state;
        if (current.payloadStatus === 'expired' || ['completed', 'failed', 'cancelled', 'indeterminate'].includes(current.status) || current.error) return current;
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(new Error('Interrupted operation')); };
          const timer = setTimeout(() => { bounded.removeEventListener('abort', abort); resolve(); }, 250);
          bounded.addEventListener('abort', abort, { once: true }); if (bounded.aborted) abort();
        });
      }
      } finally { bounded.removeEventListener('abort', disconnect); }
    } finally { socket?.removeAllListeners(); socket?.disconnect(); bounded.removeEventListener('abort', cancel); }
  }
}
