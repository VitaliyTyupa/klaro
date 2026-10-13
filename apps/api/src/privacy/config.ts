import { createHash } from 'node:crypto';
import { ProcessingDisclosureSchema, type ProcessingDisclosure } from '@klaro/contracts';

export const RETENTION = { payloadMs: 30 * 60000, resultMs: 15 * 60000, digestHours: 24, metadataDays: 30, supplementDays: 7 } as const;
export function processingDisclosure(environment: NodeJS.ProcessEnv = process.env): ProcessingDisclosure {
  const provider = environment['AI_PROVIDER'] === 'openai' ? 'openai' : environment['AI_PROVIDER'] === 'double' ? 'test-double' : 'disabled';
  const settings = {
    provider, providerStore: false,
    providerRetention: provider === 'disabled' ? 'Передача до AI-провайдера вимкнена.' : provider === 'test-double' ? 'Локальний тестовий провайдер; зовнішньої передачі немає.' : environment['PROVIDER_RETENTION_NOTICE'] || 'Строки зберігання у провайдера для цього розгортання не підтверджені. store:false вимикає збереження відповіді як ресурсу API, але не встановлює строки інших журналів провайдера.',
    backend: { payloadMaximumMinutes: RETENTION.payloadMs / 60000, resultMaximumMinutes: RETENTION.resultMs / 60000, digestHours: RETENTION.digestHours, metadataDays: RETENTION.metadataDays, supplementDays: RETENTION.supplementDays },
  };
  return ProcessingDisclosureSchema.parse({ ...settings, version: createHash('sha256').update('processing-disclosure-v1:').update(JSON.stringify(settings)).digest('hex') });
}
