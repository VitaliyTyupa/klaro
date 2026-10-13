import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { controls } from './runtime';
import { authenticateOperator } from './observability';
import { errorStatus, transportError } from '../operations/transport-errors';
import { ApplicationError } from '../operations/errors';
@Controller('v1/admin')
export class AdminController {
  private async respond(request: IncomingMessage, response: ServerResponse, action: (actor: string) => Promise<unknown>): Promise<void> {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json');
    try { const result = await action(authenticateOperator(request)); response.end(JSON.stringify(result)); }
    catch (error) { const detail = transportError(error); response.statusCode = errorStatus(detail); response.end(JSON.stringify(detail)); }
  }
  @Post('ai')
  @HttpCode(200)
  async ai(@Req() request: IncomingMessage, @Body() body: unknown, @Res() response: ServerResponse): Promise<void> {
    await this.respond(request, response, async actor => { const parsed = z.strictObject({ enabled: z.boolean() }).safeParse(body); if (!parsed.success) throw new ApplicationError('invalid-request'); await controls.setEnabled(parsed.data.enabled, actor); return { enabled: parsed.data.enabled }; });
  }
  @Get('metrics')
  async metrics(@Req() request: IncomingMessage, @Res() response: ServerResponse): Promise<void> { await this.respond(request, response, actor => controls.metrics(actor)); }
}
