import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ReferenceSectionSchema, type OperationCommand, type OperationResult, type ReferenceSection, type ReferenceLanguage, type AiSupplement } from '@klaro/contracts';
import { ReferenceService } from './service';
import { ApplicationError } from '../operations/errors';
export class SupplementService {
  private readonly pool: pg.Pool; private readonly reference: ReferenceService;
  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url, max: 3 }); this.reference = new ReferenceService(url); }
  async close(): Promise<void> { await this.pool.end(); await this.reference.close(); }
  async prepare(command: OperationCommand): Promise<OperationCommand> {
    if (!['lexical-supplement', 'source-translation'].includes(command.operationType)) return command;
    if (command.parent || command.recommendation) throw new ApplicationError('invalid-request');
    const lexical = command.lexical!; const parsed = ReferenceSectionSchema.safeParse(lexical.section);
    if (!parsed.success || Boolean(lexical.entryId) !== Boolean(lexical.sourceVersion)) throw new ApplicationError('invalid-request');
    if (!lexical.entryId) { if (command.operationType !== 'lexical-supplement' || parsed.data !== 'definitions' || lexical.senseId) throw new ApplicationError('invalid-request'); return command; }
    if (!z.uuid().safeParse(lexical.entryId).success || !z.uuid().safeParse(lexical.sourceVersion).success || lexical.senseId && !z.uuid().safeParse(lexical.senseId).success) throw new ApplicationError('invalid-request');
    let card = await this.reference.card(lexical.entryId, lexical.sourceVersion!, command.preferences.nativeLanguage);
    const section = await this.reference.section(lexical.entryId, lexical.sourceVersion!, parsed.data);
    if (!card || !section || section.state === 'not-applicable' || card.language !== command.sourceLanguage) throw new ApplicationError('invalid-request');
    if (lexical.senseId && !card.senses.some(sense => sense.id === lexical.senseId)) {
      const sense = (await this.pool.query('SELECT id, position FROM klaro.lexical_senses WHERE id = $1 AND entry_id = $2 AND release_id = $3', [lexical.senseId, lexical.entryId, lexical.sourceVersion])).rows[0];
      if (!sense) throw new ApplicationError('invalid-request');
      const selectedCard = await this.reference.card(lexical.entryId, lexical.sourceVersion!, command.preferences.nativeLanguage, Number(sense.position));
      if (!selectedCard) throw new ApplicationError('invalid-request');
      card = selectedCard;
    }
    let input: string;
    if (command.operationType === 'source-translation') {
      const items = section.items.filter(item => !lexical.senseId || item.senseId === lexical.senseId);
      if (!items.length) throw new ApplicationError('invalid-request');
      if (new Set(items.map(item => item.language ?? card.language)).size !== 1) throw new ApplicationError('invalid-request');
      input = items.map(item => item.text).join('\n');
      return { ...command, input, sourceLanguage: items[0]!.language ?? card.language, selection: { scope: 'document' }, protectedSpans: [] };
    }
    if (section.items.some(item => !lexical.senseId || item.senseId === lexical.senseId)) throw new ApplicationError('conflict');
    input = JSON.stringify({ lemma: card.lemma, language: card.language, partOfSpeech: card.partOfSpeech, features: card.features, section: parsed.data, senses: card.senses.filter(sense => !lexical.senseId || sense.id === lexical.senseId).map(sense => ({ id: sense.id, definitions: sense.definitions })) });
    return { ...command, input, selection: { scope: 'document' }, protectedSpans: [] };
  }
  async store(command: OperationCommand, result: OperationResult, policy: string): Promise<void> {
    if (result.kind !== 'lexical' || !command.lexical?.entryId || !command.lexical.sourceVersion || command.context || command.parent || command.recommendation) return;
    const section = await this.reference.section(command.lexical.entryId, command.lexical.sourceVersion, ReferenceSectionSchema.parse(command.lexical.section));
    if (!section || section.state === 'not-applicable' || result.originKind === 'generated-unverified' && section.items.some(item => !command.lexical?.senseId || item.senseId === command.lexical.senseId)) return;
    await this.pool.query(`INSERT INTO klaro.ai_supplements (id, entry_id, release_id, sense_key, section, target_language, policy_version, origin_kind, text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (entry_id, release_id, sense_key, section, target_language, policy_version, origin_kind) DO UPDATE SET id = excluded.id, text = excluded.text, created_at = now(), expires_at = now() + interval '7 days'`, [randomUUID(), command.lexical.entryId, command.lexical.sourceVersion, command.lexical.senseId ?? '', command.lexical.section, command.targetLanguage, policy, result.originKind, result.text]);
  }
  async get(entryId: string, sourceVersion: string, section: ReferenceSection, targetLanguage: ReferenceLanguage, origin: AiSupplement['originKind'], policy: string, senseId?: string): Promise<AiSupplement | undefined> {
    const data = await this.reference.section(entryId, sourceVersion, section);
    if (!data || data.state === 'not-applicable' || origin === 'generated-unverified' && data.items.some(item => !senseId || item.senseId === senseId)) return undefined;
    const row = (await this.pool.query('SELECT * FROM klaro.ai_supplements WHERE entry_id = $1 AND release_id = $2 AND sense_key = $3 AND section = $4 AND target_language = $5 AND origin_kind = $6 AND policy_version = $7 AND expires_at > now()', [entryId, sourceVersion, senseId ?? '', section, targetLanguage, origin, policy])).rows[0];
    if (!row) return undefined;
    return { id: row.id, entryId, sourceVersion, ...(senseId ? { senseId } : {}), section, targetLanguage, originKind: row.origin_kind, text: row.text, expiresAt: row.expires_at.toISOString() };
  }
  async report(userId: string, targetId: string, targetKind: 'reference' | 'supplement', reason: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const user = await client.query("SELECT id FROM klaro.users WHERE id = $1 AND status = 'active' FOR UPDATE", [userId]); if (!user.rowCount) throw new ApplicationError('unauthenticated');
      const count = (await client.query("SELECT count(*) FROM klaro.reference_error_reports WHERE user_id = $1 AND created_at > now() - interval '24 hours'", [userId])).rows[0].count;
      if (Number(count) >= 5) throw new ApplicationError('quota-exceeded');
      const found = targetKind === 'reference' ? await client.query('SELECT id FROM klaro.admitted_lexical_entries WHERE id = $1', [targetId]) : await client.query(`SELECT s.id FROM klaro.ai_supplements s JOIN klaro.admitted_lexical_entries e ON e.id = s.entry_id AND e.release_id = s.release_id WHERE s.id = $1 AND s.expires_at > now() UNION SELECT o.id FROM klaro.operations o WHERE o.id = $1 AND o.user_id = $2 AND o.operation_type IN ('lexical-supplement', 'source-translation') AND o.result_version > 0`, [targetId, userId]);
      if (!found.rowCount) throw new ApplicationError('invalid-request');
      await client.query('INSERT INTO klaro.reference_error_reports (id,user_id,target_id,target_kind,reason) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), userId, targetId, targetKind, reason]); await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}
