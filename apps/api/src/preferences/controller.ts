import type { IncomingMessage, ServerResponse } from 'node:http';
import { BadRequestException, Body, Controller, Get, Put, Req, Res, UnauthorizedException } from '@nestjs/common';
import { PreferencesSchema } from '@klaro/contracts';
import { authenticateRequest } from '../identity/controller';
import { PreferencesService } from './service';

const preferences = new PreferencesService(process.env['DATABASE_URL'] ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro');

@Controller('v1/me/preferences')
export class PreferencesController {
  @Get()
  async get(@Req() request: IncomingMessage, @Res() response: ServerResponse): Promise<void> {
    const session = await authenticateRequest(request);
    const value = await preferences.get(session.userId);
    if (!value) throw new UnauthorizedException({ code: 'unauthenticated', retryable: false });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(value));
  }

  @Put()
  async update(@Req() request: IncomingMessage, @Body() body: unknown, @Res() response: ServerResponse): Promise<void> {
    const session = await authenticateRequest(request, true);
    const parsed = PreferencesSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: 'invalid-request', retryable: false });
    const value = await preferences.update(session.userId, parsed.data);
    if (!value) throw new UnauthorizedException({ code: 'unauthenticated', retryable: false });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(value));
  }
}
