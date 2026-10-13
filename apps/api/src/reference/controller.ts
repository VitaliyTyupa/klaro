import type { IncomingMessage, ServerResponse } from 'node:http';
import { BadRequestException, Body, Controller, Get, Post, NotFoundException, Param, Query, Req, Res, HttpException } from '@nestjs/common';
import { LanguageSchema, ReferenceLookupSchema, ReferenceSectionSchema, ReferenceReportSchema } from '@klaro/contracts';
import { z } from 'zod';
import { authenticateRequest } from '../identity/controller';
import { SupplementService } from './supplements';
import { operations } from '../operations/runtime';
import { ApplicationError } from '../operations/errors';
import { errorStatus, transportError } from '../operations/transport-errors';
import { PreferencesService } from '../preferences/service';
import { ReferenceService } from './service';
const reference = new ReferenceService(process.env['DATABASE_URL'] ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro');
const supplements = new SupplementService(process.env['DATABASE_URL'] ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro');
const preferences = new PreferencesService(process.env['DATABASE_URL'] ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro');
const key = z.uuid();
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const parsed = schema.safeParse(value); if (!parsed.success) throw new BadRequestException({ code: 'invalid-request', retryable: false }); return parsed.data; }
function send(response: ServerResponse, value: unknown): void { if (!value) throw new NotFoundException({ code: 'reference-unavailable', retryable: false }); response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); }
@Controller('v1/reference')
export class ReferenceController {
  @Get('supplements')
  async supplement(@Req() request: IncomingMessage, @Query() query: unknown, @Res() response: ServerResponse): Promise<void> {
    const actor = await authenticateRequest(request);
    const profile = await preferences.get(actor.userId); if (!profile) throw new BadRequestException({ code: 'unauthenticated', retryable: false });
    const input = parse(z.strictObject({ entryId: key, sourceVersion: key, senseId: key.optional(), section: ReferenceSectionSchema, targetLanguage: LanguageSchema, originKind: z.enum(['machine-translation', 'generated-unverified']) }), query);
    send(response, { supplement: await supplements.get(input.entryId, input.sourceVersion, input.section, input.targetLanguage, input.originKind, operations.policyKey(profile), input.senseId) ?? null });
  }
  @Post('reports')
  async report(@Req() request: IncomingMessage, @Body() body: unknown, @Res() response: ServerResponse): Promise<void> {
    const actor = await authenticateRequest(request, true); const input = parse(ReferenceReportSchema, body);
    try { await supplements.report(actor.userId, input.targetId, input.targetKind, input.reason); send(response, { received: true }); }
    catch (error) { if (error instanceof ApplicationError) throw new HttpException(transportError(error), errorStatus(error.detail)); throw error; }
  }
  @Get('lookup')
  async lookup(@Req() request: IncomingMessage, @Query() query: unknown, @Res() response: ServerResponse): Promise<void> { await authenticateRequest(request); const input = parse(ReferenceLookupSchema, query); send(response, await reference.lookup(input.language, input.query, input.offset)); }
  @Get('entries/:id')
  async card(@Req() request: IncomingMessage, @Param('id') id: string, @Query() query: unknown, @Res() response: ServerResponse): Promise<void> { await authenticateRequest(request); const input = parse(z.strictObject({ sourceVersion: key, nativeLanguage: LanguageSchema, offset: z.coerce.number().int().min(0).max(10000).default(0) }), query); send(response, await reference.card(parse(key, id), input.sourceVersion, input.nativeLanguage, input.offset)); }
  @Get('entries/:id/sections')
  async availability(@Req() request: IncomingMessage, @Param('id') id: string, @Query() query: unknown, @Res() response: ServerResponse): Promise<void> { await authenticateRequest(request); const input = parse(z.strictObject({ sourceVersion: key }), query); send(response, await reference.availability(parse(key, id), input.sourceVersion)); }
  @Get('entries/:id/sections/:section')
  async section(@Req() request: IncomingMessage, @Param('id') id: string, @Param('section') section: string, @Query() query: unknown, @Res() response: ServerResponse): Promise<void> { await authenticateRequest(request); const input = parse(z.strictObject({ sourceVersion: key }), query); send(response, await reference.section(parse(key, id), input.sourceVersion, parse(ReferenceSectionSchema, section))); }
}
