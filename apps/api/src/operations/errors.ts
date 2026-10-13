import type { StructuredError } from '@klaro/contracts';

export class ApplicationError extends Error {
  readonly detail: StructuredError;
  constructor(code: StructuredError['code'], retryable = false) {
    super(code);
    this.detail = { code, retryable };
  }
}
