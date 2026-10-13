import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { DEFAULT_PREFERENCES, ReferenceReportSchema } from '@klaro/contracts';
import { SessionService } from '../dist/api/identity/sessions.js';
import { OperationApplicationService } from '../dist/api/operations/service.js';
import { PayloadStore } from '../dist/api/operations/payloads.js';
import { DeterministicProvider } from '../dist/api/ai/double.js';
import { SupplementService } from '../dist/api/reference/supplements.js';
import { BudgetService, DOUBLE_BUDGET_POLICY } from '../dist/api/operations/budgets.js';
export async function testSupplements(pool, url, service, releaseId) {
  const sessions = new SessionService(url); const supplements = new SupplementService(url); const services = [];
  const identity = await sessions.signIn({ issuer: `https://reference-fixture.test/${randomUUID()}`, subject: 'fixture' });
  const actor = await sessions.authenticate(identity.token, 'web'); const captured = []; let refusal = false;
  const double = new DeterministicProvider(); const provider = { id: 'double', execute: async (task, signal) => { captured.push(task); return refusal ? { candidate: undefined, usage: { inputTokens: 1, outputTokens: 0 }, outcome: 'refusal' } : double.execute(task, signal); } };
  const settings = { databaseUrl: url, payloads: new PayloadStore(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380'), hmacKey: randomBytes(32).toString('hex'), provider };
  const operations = new OperationApplicationService(settings); services.push(operations);
  const entry = (await service.lookup('de', 'gehen')).candidates[0];
  const command = (overrides = {}) => ({ version: 'v1', clientRequestId: randomUUID(), revisionId: randomUUID(), operationType: 'lexical-supplement', surface: 'web', input: 'Private canary must be ignored for a sourced entry', selection: { scope: 'document' }, preferences: DEFAULT_PREFERENCES, sourceLanguage: 'de', targetLanguage: 'uk', lexical: { entryId: entry.id, sourceVersion: releaseId, section: 'subjunctive' }, ...overrides });
  const complete = async input => { const accepted = await operations.accept(actor, input); for (let i = 0; i < 100; i++) { const result = await operations.snapshot(actor, accepted.operationId); if (['completed', 'failed'].includes(result.status)) return result; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Supplement timed out'); };
  try {
    const canonicalCount = (await pool.query('SELECT count(*) FROM klaro.lexical_entries WHERE release_id = $1', [releaseId])).rows[0].count;
    const generated = await complete(command()); assert.equal(generated.results[0].originKind, 'generated-unverified'); assert.equal(captured[0].text.includes('Private canary'), false);
    const cached = await supplements.get(entry.id, releaseId, 'subjunctive', 'uk', 'generated-unverified', operations.policyKey()); assert.ok(cached); assert.equal(cached.text, generated.results[0].text);
    assert.equal(await supplements.get(entry.id, releaseId, 'subjunctive', 'uk', 'generated-unverified', 'different-policy'), undefined);
    assert.equal(await supplements.get(entry.id, releaseId, 'subjunctive', 'uk', 'generated-unverified', operations.policyKey({ style: 'formal', proficiency: null })), undefined);
    const privateResult = await complete(command({ context: 'Private context canary', lexical: { entryId: entry.id, sourceVersion: releaseId, section: 'imperative' } })); assert.equal(privateResult.status, 'completed');
    assert.equal(await supplements.get(entry.id, releaseId, 'imperative', 'uk', 'generated-unverified', operations.policyKey()), undefined);
    const unknown = await complete(command({ input: 'unknown-fixture', lexical: { section: 'definitions' } })); assert.equal(unknown.status, 'completed');
    assert.equal((await pool.query('SELECT count(*) FROM klaro.ai_supplements WHERE release_id = $1', [releaseId])).rows[0].count, '1');
    const card = await service.card(entry.id, releaseId, 'uk');
    const translated = await complete(command({ operationType: 'source-translation', lexical: { entryId: entry.id, sourceVersion: releaseId, section: 'definitions', senseId: card.senses[0].id } })); assert.equal(translated.results[0].originKind, 'machine-translation'); assert.equal(captured.at(-1).text, 'to go'); assert.equal(captured.at(-1).sourceLanguage, 'en');
    const later = await service.card(entry.id, releaseId, 'uk', 5); assert.equal(later.senses.length, 1);
    const laterTranslated = await complete(command({ operationType: 'source-translation', lexical: { entryId: entry.id, sourceVersion: releaseId, section: 'definitions', senseId: later.senses[0].id } })); assert.equal(laterTranslated.status, 'completed'); assert.equal(captured.at(-1).text, 'fixture sense 6');
    assert.equal((await pool.query('SELECT count(*) FROM klaro.usage_ledger WHERE user_id = $1', [identity.userId])).rows[0].count, '5');
    await assert.rejects(operations.accept(actor, command({ lexical: { entryId: entry.id, sourceVersion: releaseId, section: 'declension' } })), /invalid-request/);
    await assert.rejects(operations.accept(actor, command({ lexical: { entryId: entry.id, sourceVersion: releaseId, section: 'definitions' } })), /conflict/);
    refusal = true; const refused = await complete(command({ lexical: { entryId: entry.id, sourceVersion: releaseId, section: 'imperative' } })); assert.equal(refused.error.code, 'provider-refusal'); refusal = false;
    assert.equal(await supplements.get(entry.id, releaseId, 'imperative', 'uk', 'generated-unverified', operations.policyKey()), undefined);
    const limited = new OperationApplicationService({ ...settings, payloads: new PayloadStore(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380'), budgets: new BudgetService({ ...DOUBLE_BUDGET_POLICY, userDailyTokens: 0 }) }); services.push(limited); await assert.rejects(limited.accept(actor, command()), /quota-exceeded/);
    await pool.query("UPDATE klaro.ai_supplements SET expires_at = now() - interval '1 second' WHERE id = $1", [cached.id]); assert.equal(await supplements.get(entry.id, releaseId, 'subjunctive', 'uk', 'generated-unverified', operations.policyKey()), undefined);
    const form = (await pool.query('SELECT id FROM klaro.lexical_inflections WHERE entry_id = $1 LIMIT 1', [entry.id])).rows[0];
    await pool.query("UPDATE klaro.lexical_inflections SET tags = ARRAY['subjunctive'] WHERE id = $1", [form.id]);
    await pool.query("UPDATE klaro.ai_supplements SET expires_at = now() + interval '1 day' WHERE id = $1", [cached.id]); assert.equal(await supplements.get(entry.id, releaseId, 'subjunctive', 'uk', 'generated-unverified', operations.policyKey()), undefined);
    assert.equal(ReferenceReportSchema.safeParse({ targetId: entry.id, targetKind: 'reference', reason: 'other', text: 'private' }).success, false);
    await supplements.report(identity.userId, privateResult.operationId, 'supplement', 'wrong-form');
    for (let i = 0; i < 4; i++) await supplements.report(identity.userId, entry.id, 'reference', 'wrong-form'); await assert.rejects(supplements.report(identity.userId, entry.id, 'reference', 'wrong-form'), /quota-exceeded/);
    assert.equal((await pool.query('SELECT count(*) FROM klaro.lexical_entries WHERE release_id = $1', [releaseId])).rows[0].count, canonicalCount);
  } finally { const cleanup = new PayloadStore(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380'); const ids = (await pool.query('SELECT id FROM klaro.operations WHERE user_id = $1', [identity.userId])).rows; for (const row of ids) await cleanup.delete(identity.userId, row.id); await cleanup.close(); await Promise.all(services.map(instance => instance.close())); await supplements.close(); await pool.query('DELETE FROM klaro.users WHERE id = $1', [identity.userId]); await sessions.close(); }
}
