import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IdentityController } from './identity/controller';
import { PreferencesController } from './preferences/controller';
import { OperationsController } from './operations/controller';
import { OperationsGateway } from './operations/gateway';
import { operations } from './operations/runtime';
import { ReferenceController } from './reference/controller';
import { accountPrivacy, retention, controls } from './privacy/runtime';
import { AdminController } from './privacy/admin-controller';
import { SafeErrorFilter } from './privacy/error-filter';
import { httpMetrics, safeLog } from './privacy/observability';
import { AccountPrivacyController } from './privacy/account-controller';
import { PrivacyController } from './privacy/controller';
import { UsageController } from './operations/usage';

@Controller('health')
class HealthController {
  @Get()
  health(): { status: string } {
    return { status: 'ok' };
  }
}

@Module({ controllers: [HealthController, AdminController, AccountPrivacyController, PrivacyController, ReferenceController, IdentityController, PreferencesController, OperationsController, UsageController], providers: [OperationsGateway] })
class AppModule {}

async function bootstrap(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production' && (!process.env['DELETION_JOURNAL_FILE'] || !/^[a-fA-F0-9]{64}$/.test(process.env['DELETION_JOURNAL_KEY'] ?? ''))) throw new Error('Durable deletion journal required');
  await controls.initialize();
  await accountPrivacy.retryDeletions();
  await retention.cleanup();
  await operations.recover();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.useGlobalFilters(new SafeErrorFilter());
  app.use((_request: unknown, response: import('node:http').ServerResponse, next: () => void) => {
    const start = performance.now(); response.on('finish', () => { const duration = performance.now() - start; httpMetrics.requests++; httpMetrics.failures += Number(response.statusCode >= 500); httpMetrics.totalLatencyMs += duration; httpMetrics.maximumLatencyMs = Math.max(httpMetrics.maximumLatencyMs, duration); console.info(safeLog('request', response.statusCode, duration)); }); next();
  });
  app.enableCors({ origin: [process.env['APP_ORIGIN'] ?? 'http://localhost:4200', ...(process.env['EXTENSION_ORIGINS'] ?? '').split(',').filter(Boolean)], credentials: false, methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'] });
  app.useBodyParser('json', { limit: '1mb' });
  await app.listen(Number(process.env['PORT'] ?? 3000), '127.0.0.1');
  const reconciliation = setInterval(() => { void operations.reconcile().catch(() => {}); void accountPrivacy.retryDeletions().catch(() => console.error(safeLog('cleanup-failed'))); void retention.cleanup().catch(() => console.error(safeLog('cleanup-failed'))); }, 60000);
  reconciliation.unref();
  app.getHttpServer().on('close', () => clearInterval(reconciliation));
}

void bootstrap().catch(() => {
  console.error(safeLog('startup-failed'));
  process.exitCode = 1;
});
