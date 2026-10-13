import { Body, Controller, Delete, Get, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { authenticateRequest } from '../identity/controller';
import { accountPrivacy } from './runtime';
import { ApplicationError } from '../operations/errors';
import { errorStatus, transportError } from '../operations/transport-errors';
const confirmation = z.strictObject({ confirmation: z.literal('DELETE') });
@Controller('v1/me')
export class AccountPrivacyController {
  private async respond(response: ServerResponse, action: () => Promise<unknown>, status = 200): Promise<void> {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json');
    try { const value = await action(); response.statusCode = status; response.end(JSON.stringify(value)); }
    catch (error) { response.removeHeader('Content-Disposition'); const detail = transportError(error); response.statusCode = errorStatus(detail); response.end(JSON.stringify(detail)); }
  }
  @Get('export')
  async export(@Req() request: IncomingMessage, @Res() response: ServerResponse): Promise<void> {
    await this.respond(response, async () => { const actor = await authenticateRequest(request); const data = await accountPrivacy.export(actor); response.setHeader('Content-Disposition', 'attachment; filename="klaro-account.json"'); return data; });
  }
  @Delete('account')
  async delete(@Req() request: IncomingMessage, @Body() body: unknown, @Res() response: ServerResponse): Promise<void> {
    await this.respond(response, async () => { const actor = await authenticateRequest(request, true); if (!confirmation.safeParse(body).success) throw new ApplicationError('invalid-request'); return accountPrivacy.delete(actor); }, 202);
  }
}
