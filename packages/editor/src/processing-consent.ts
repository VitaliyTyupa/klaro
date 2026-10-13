import { ProcessingDisclosureSchema, type ProcessingDisclosure } from '@klaro/contracts';

/** In-memory consent. No command, input, identity or approval is persisted. */
export class ProcessingConsent {
  disclosure: ProcessingDisclosure | undefined;
  pending = false;
  private approvedVersion: string | undefined;
  private decision: ((approved: boolean) => void) | undefined;
  private readonly origin: string;
  private readonly notify: () => void;
  private readonly request: typeof fetch;
  constructor(origin: string, notify: () => void = () => {}, request: typeof fetch = (input, init) => fetch(input, init)) { this.origin = origin; this.notify = notify; this.request = request; }
  async authorize(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const response = await this.request(`${this.origin}/v1/privacy/processing`, { cache: 'no-store', credentials: 'omit', signal });
    if (!response.ok) throw new Error('unavailable');
    const disclosure = ProcessingDisclosureSchema.parse(await response.json());
    signal.throwIfAborted();
    if (disclosure.version === this.approvedVersion) return;
    if (this.pending) throw new Error('conflict');
    this.disclosure = disclosure; this.pending = true; this.notify();
    const approved = await new Promise<boolean>(resolve => {
      const abort = () => this.decide(false);
      this.decision = value => { signal.removeEventListener('abort', abort); resolve(value); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    signal.throwIfAborted();
    if (!approved) throw new Error('cancelled');
    this.approvedVersion = disclosure.version;
  }
  decide(approved: boolean): void { const decision = this.decision; this.decision = undefined; this.pending = false; decision?.(approved); this.notify(); }
  reset(): void { this.approvedVersion = undefined; this.decide(false); this.disclosure = undefined; this.notify(); }
}
