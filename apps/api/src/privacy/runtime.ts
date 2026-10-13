import { AccountPrivacyService } from './accounts';
import { operations, payloads } from '../operations/runtime';
export const accountPrivacy = new AccountPrivacyService(process.env['DATABASE_URL'] ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro', payloads, userId => operations.abortUser(userId));

import { RetentionService } from './retention';
export const retention = new RetentionService(process.env['DATABASE_URL'] ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro');

import { OperationalControls } from './observability';
export const controls = new OperationalControls(process.env['DATABASE_URL'] ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro');
