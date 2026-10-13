import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticateRequest } from '../identity/controller';
import { operations } from './runtime';
import { errorStatus, transportError } from './transport-errors';
import { FeedbackService } from './feedback';
const feedback = new FeedbackService(process.env['DATABASE_URL'] ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro');

@Controller('v1/operations')
export class OperationsController {
  private async respond(response: ServerResponse, action: () => Promise<unknown>, status = 200): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    try { const result = await action(); response.statusCode = status; response.end(JSON.stringify(result)); }
    catch (error) { const detail = transportError(error); response.statusCode = errorStatus(detail); response.end(JSON.stringify(detail)); }
  }

  @Post()
  async accept(@Req() request: IncomingMessage, @Body() body: unknown, @Res() response: ServerResponse): Promise<void> {
    await this.respond(response, async () => operations.accept(await authenticateRequest(request, true), body), 202);
  }

  @Get(':id')
  async snapshot(@Req() request: IncomingMessage, @Param('id') id: string, @Res() response: ServerResponse): Promise<void> {
    await this.respond(response, async () => operations.snapshot(await authenticateRequest(request), id));
  }

  @Post(':id/cancel')
  async cancel(@Req() request: IncomingMessage, @Param('id') id: string, @Res() response: ServerResponse): Promise<void> {
    await this.respond(response, async () => operations.cancel(await authenticateRequest(request, true), id));
  }

  @Post(':id/feedback')
  async feedback(@Req() request: IncomingMessage, @Param('id') id: string, @Body() body: unknown, @Res() response: ServerResponse): Promise<void> {
    await this.respond(response, async () => feedback.submit(await authenticateRequest(request, true), id, body));
  }
}
