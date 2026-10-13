import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { errorStatus, transportError } from '../operations/transport-errors';
@Catch()
export class SafeErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ServerResponse>();
    if (response.headersSent) { response.end(); return; }
    const status = error instanceof HttpException ? error.getStatus() : error && typeof error === 'object' && 'status' in error ? Number(error.status) : undefined;
    const detail = status === 413 ? { code: 'input-too-large' as const, retryable: false } : status === 400 ? { code: 'invalid-request' as const, retryable: false } : transportError(error); response.statusCode = errorStatus(detail);
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(detail));
  }
}
