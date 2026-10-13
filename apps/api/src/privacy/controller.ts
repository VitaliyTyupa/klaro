import { Controller, Get, Res } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { processingDisclosure } from './config';

@Controller('v1/privacy')
export class PrivacyController {
  @Get('processing')
  disclosure(@Res() response: ServerResponse): void {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(processingDisclosure()));
  }
}
