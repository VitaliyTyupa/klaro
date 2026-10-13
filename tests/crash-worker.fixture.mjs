import { SessionService } from '../dist/api/identity/sessions.js';
import { OperationApplicationService } from '../dist/api/operations/service.js';
import { PayloadStore } from '../dist/api/operations/payloads.js';
import { DeterministicProvider } from '../dist/api/ai/double.js';
const sessions = new SessionService(process.env.DATABASE_URL);
const actor = await sessions.authenticate(process.env.TEST_SESSION_TOKEN, 'web');
const app = new OperationApplicationService({ databaseUrl: process.env.DATABASE_URL, payloads: new PayloadStore(process.env.REDIS_URL), hmacKey: process.env.OPERATION_HMAC_KEY, provider: new DeterministicProvider(60000) });
const accepted = await app.accept(actor, JSON.parse(process.env.TEST_COMMAND));
process.send(accepted);
