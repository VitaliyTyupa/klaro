import { DeterministicProvider } from '../ai/double';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { OpenAiResponsesAdapter } from '../ai/openai-responses';
import { PolicyRegistry } from '../ai/policies';
import { OperationalControls } from '../privacy/observability';
import { PayloadStore } from './payloads';
import { OperationApplicationService } from './service';
import { BudgetService } from './budgets';
import { loadBudgetPolicy } from './budget-configuration';

if (process.env['AI_PROVIDER'] === 'double' && process.env['NODE_ENV'] === 'production') throw new Error('Test provider is forbidden in production');
const providerId = process.env['AI_PROVIDER'] || 'double';
const nativeIncompleteOnce = process.env['AI_DOUBLE_NATIVE_INCOMPLETE_ONCE'] === 'true';
if (nativeIncompleteOnce && (process.env['NODE_ENV'] !== 'test' || providerId !== 'double')) throw new Error('Synthetic failure requires the test provider and environment');
if (!['double', 'openai'].includes(providerId)) throw new Error('Unknown provider');
const configuration = process.env['AI_POLICY_FILE'] ? z.strictObject({ active: z.string(), policies: z.array(z.unknown()).min(1).max(20) }).parse(JSON.parse(readFileSync(process.env['AI_POLICY_FILE'], 'utf8'))) : undefined;
if (providerId === 'openai' && !configuration) throw new Error('Explicit model and price policies required');
const policies = configuration ? new PolicyRegistry(configuration.policies, configuration.active, providerId) : new PolicyRegistry();
export const payloads = new PayloadStore(process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6380');
const controls = new OperationalControls(process.env['DATABASE_URL'] ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro');
export const operations = new OperationApplicationService({
  databaseUrl: process.env['DATABASE_URL'] ?? 'postgresql://klaro:klaro-local-development@127.0.0.1:5433/klaro',
  payloads,
  enabled: () => controls.enabled(),
  hmacKey: process.env['OPERATION_HMAC_KEY'],
  policies,
  budgets: new BudgetService(loadBudgetPolicy(process.env['AI_BUDGET_FILE'])),
  provider: process.env['AI_PROVIDER'] === 'double' ? new DeterministicProvider(100, nativeIncompleteOnce) : process.env['AI_PROVIDER'] === 'openai' ? new OpenAiResponsesAdapter(process.env['OPENAI_API_KEY'] ?? '') : undefined,
});
