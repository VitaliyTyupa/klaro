import { createClient } from 'redis';
import { OperationCommandSchema, OperationResultSchema, StructuredErrorSchema, type OperationCommand, type OperationResult, type StructuredError } from '@klaro/contracts';
import { z } from 'zod';
import { RETENTION } from '../privacy/config';
import { ApplicationError } from './errors';

const payloadSchema = z.strictObject({ command: OperationCommandSchema, results: z.array(OperationResultSchema).max(5), sequence: z.number().int().nonnegative(), error: StructuredErrorSchema.optional() });
export interface PrivatePayload {
  command: OperationCommand;
  results: OperationResult[];
  sequence: number;
  error?: StructuredError;
}

export class PayloadStore {
  private readonly client;
  private connection: Promise<unknown> | undefined;
  constructor(url: string, private readonly absoluteTtlMs = RETENTION.payloadMs, private readonly resultTtlMs = RETENTION.resultMs) {
    if (absoluteTtlMs <= 0 || absoluteTtlMs > 1800000 || resultTtlMs <= 0 || resultTtlMs > 900000) throw new Error('Invalid payload TTL');
    this.client = createClient({ url, disableOfflineQueue: true, socket: { connectTimeout: 3000, reconnectStrategy: false } });
    this.client.on('error', () => { /* Driver errors must not expose credentials or payloads. */ });
    this.client.on('end', () => { this.connection = undefined; });
  }

  private async ready(): Promise<void> {
    if (this.client.isReady) return;
    this.connection ??= this.client.connect().catch(() => {
      this.connection = undefined;
      throw new ApplicationError('unavailable', true);
    });
    await this.connection;
    if (!this.client.isReady) throw new ApplicationError('unavailable', true);
  }

  private key(userId: string, operationId: string): string {
    if (!z.uuid().safeParse(userId).success || !z.uuid().safeParse(operationId).success) throw new ApplicationError('invalid-request');
    return `klaro:payload:${userId}:${operationId}`;
  }

  async create(userId: string, operationId: string, command: OperationCommand): Promise<void> {
    await this.ready();
    const value = payloadSchema.parse({ command, results: [], sequence: 0 });
    const accepted = await this.client.set(this.key(userId, operationId), JSON.stringify(value), { expiration: { type: 'PX', value: this.absoluteTtlMs }, condition: 'NX' });
    if (!accepted) throw new ApplicationError('conflict');
  }

  async get(userId: string, operationId: string): Promise<PrivatePayload | undefined> {
    await this.ready();
    const value = await this.client.get(this.key(userId, operationId));
    if (!value) return undefined;
    const parsed = payloadSchema.safeParse(JSON.parse(value));
    if (!parsed.success) throw new ApplicationError('invalid-result');
    return parsed.data;
  }

  async update(userId: string, operationId: string, payload: PrivatePayload, completed = false): Promise<void> {
    await this.ready();
    const value = payloadSchema.parse(payload);
    const updated = await this.client.eval(`
      local ttl = redis.call('PTTL', KEYS[1])
      if ttl <= 0 then return 0 end
      local previous = cjson.decode(redis.call('GET', KEYS[1]))
      if previous.sequence > tonumber(ARGV[2]) then return -1 end
      if tonumber(ARGV[3]) > 0 then ttl = math.min(ttl, tonumber(ARGV[3])) end
      redis.call('SET', KEYS[1], ARGV[1], 'PX', ttl)
      return 1
    `, { keys: [this.key(userId, operationId)], arguments: [JSON.stringify(value), String(value.sequence), completed ? String(this.resultTtlMs) : '0'] });
    if (updated === 0) throw new ApplicationError('payload-expired');
    if (updated === -1) throw new ApplicationError('conflict');
  }

  async delete(userId: string, operationId: string): Promise<void> {
    await this.ready();
    await this.client.del(this.key(userId, operationId));
  }

  async deleteUser(userId: string): Promise<void> {
    if (!z.uuid().safeParse(userId).success) throw new ApplicationError('invalid-request');
    await this.ready();
    for await (const keys of this.client.scanIterator({ MATCH: `klaro:payload:${userId}:*`, COUNT: 100 })) if (keys.length) await this.client.del(keys);
  }

  async close(): Promise<void> { if (this.client.isOpen) await this.client.close(); }
}
