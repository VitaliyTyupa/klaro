import { HttpException } from '@nestjs/common';
import { StructuredErrorSchema, type StructuredError } from '@klaro/contracts';
import { ApplicationError } from './errors';

export function transportError(error: unknown): StructuredError {
  if (error instanceof ApplicationError) return error.detail;
  if (error instanceof HttpException) {
    const parsed = StructuredErrorSchema.safeParse(error.getResponse());
    if (parsed.success) return parsed.data;
  }
  return { code: 'unavailable', retryable: true };
}

export function errorStatus(detail: StructuredError): number {
  switch (detail.code) {
    case 'invalid-request': return 400;
    case 'input-too-large': return 413;
    case 'unauthenticated': return 401;
    case 'forbidden': return 403;
    case 'conflict': return 409;
    case 'payload-expired': return 410;
    case 'quota-exceeded': return 429;
    default: return 503;
  }
}
