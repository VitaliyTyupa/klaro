import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { SessionService } from '../dist/api/identity/sessions.js';

const languages = ['uk', 'de', 'en', 'vi'];
const names = { uk: 'Українська', de: 'Німецька', en: 'Англійська', vi: 'В’єтнамська' };
const samples = { uk: 'Я не обіцяю 3 зустрічі. ABC-123 😀', de: 'Ich verspreche keine 3 Treffen. ABC-123 😀', en: 'I do not promise 3 meetings. ABC-123 😀', vi: 'Tôi không hứa 3 cuộc gặp. ABC-123 😀' };
const until = async (predicate, description) => {
  for (let index = 0; index < 300; index++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error(`Browser matrix timed out: ${description}`);
};

// Only test automation uses database setup; every operation is launched in the native UI.
export async function runBrowserMatrix({ evaluate, click, login, database, databaseUrl, redis, provider, surface, browser, version }) {
  const sessions = new SessionService(databaseUrl); const users = []; const cases = [];
  const readUi = () => evaluate(() => ({ text: document.body.innerText, areas: [...document.querySelectorAll('textarea')].map(input => input.value), runDisabled: [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Опрацювати')?.disabled, copyDisabled: [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Копіювати результат')?.disabled, copies: [...document.querySelectorAll('button')].filter(button => button.textContent.trim() === 'Копіювати результат').length }));
  const fill = value => evaluate(value => { const input = document.querySelector('textarea'); input.focus(); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  const countOperations = async user => Number((await database.query('SELECT count(*) FROM klaro.operations WHERE user_id = $1', [user])).rows[0].count);
  try {
    for (const nativeLanguage of languages) for (const activeWritingLanguage of languages.filter(language => language !== nativeLanguage)) for (const style of ['neutral', 'formal']) {
      const subject = `synthetic-matrix-${randomUUID()}`;
      const setup = await sessions.signIn({ issuer: provider.issuer, subject }); users.push(setup.userId);
      await sessions.revokeAll(setup.userId);
      const proficiency = style === 'formal' ? 'B2' : 'A2';
      await database.query('UPDATE klaro.user_preferences SET native_language = $2, writing_languages = $3, active_writing_language = $4, style = $5, proficiency = $6 WHERE user_id = $1', [setup.userId, nativeLanguage, [activeWritingLanguage], activeWritingLanguage, style, proficiency]);
      provider.setSubject(subject); await login();
      await until(async () => !(await readUi()).runDisabled || (await readUi()).text.includes('Вийти'), 'login');
      await click('Корекція');
      const maximum = surface === 'panel' ? 5000 : 20000;
      await fill('😀'.repeat(maximum + 1));
      await until(async () => (await readUi()).runDisabled, 'overlong input disabled');
      assert.equal(Array.from((await readUi()).areas[0]).length, maximum + 1);
      assert.equal(await countOperations(setup.userId), 0);
      // At the inclusive limit, process a selection while keeping bounded context.
      const selected = samples[activeWritingLanguage];
      const prefix = '😀 prefix '; const suffix = '😀'.repeat(maximum - Array.from(prefix + selected).length);
      const input = prefix + selected + suffix;
      await fill(input);
      await evaluate(({ start, end }) => { const input = document.querySelector('textarea'); input.setSelectionRange(start, end); input.dispatchEvent(new Event('select', { bubbles: true })); }, { start: prefix.length, end: prefix.length + selected.length });
      await until(async () => !(await readUi()).runDisabled, 'inclusive input limit');
      await click('Опрацювати');
      await until(async () => (await readUi()).text.includes('Передача тексту для обробки'), 'processing disclosure');
      assert.equal(await countOperations(setup.userId), 0);
      await click('Підтверджую передачу тексту');
      await until(async () => { const ui = await readUi(); return ui.areas[1] === selected && ui.areas[2] === selected; }, 'selected correction and native rendering');
      let ui = await readUi(); assert.equal(ui.areas[0], input); assert.equal(ui.areas.length, 3); assert.equal(ui.copies, 1);
      await click('Перекладач');
      for (const reverse of [false, true]) {
        const sourceLanguage = reverse ? activeWritingLanguage : nativeLanguage;
        const targetLanguage = reverse ? nativeLanguage : activeWritingLanguage;
        if (reverse) await click('Змінити напрямок');
        await fill(samples[sourceLanguage]);
        await until(async () => (await readUi()).text.includes(`${names[sourceLanguage]} → ${names[targetLanguage]}`), 'native-anchored direction');
        await click('Опрацювати');
        await until(async () => { const ui = await readUi(); return ui.areas[1] === samples[sourceLanguage] && !ui.copyDisabled; }, 'translation');
        ui = await readUi(); assert.equal(ui.areas.length, 2); assert.equal(ui.areas[0], samples[sourceLanguage]); assert.equal(ui.copies, 1);
      }
      await click('Змінити напрямок');
      await until(async () => (await readUi()).copyDisabled && (await readUi()).text.includes('Результат неактуальний'), 'swap invalidation');
      assert.equal(await countOperations(setup.userId), 3);
      const operations = (await database.query('SELECT id, operation_type FROM klaro.operations WHERE user_id = $1 ORDER BY created_at', [setup.userId])).rows;
      const expectedPreferences = { version: 'v1', nativeLanguage, writingLanguages: [activeWritingLanguage], activeWritingLanguage, style, proficiency };
      for (const [index, operation] of operations.entries()) {
        const payload = JSON.parse(await redis.get(`klaro:payload:${setup.userId}:${operation.id}`));
        assert.deepEqual(payload.command.preferences, expectedPreferences);
        assert.equal(payload.command.surface, surface);
        assert.ok((payload.command.context?.length ?? 0) <= 8000);
        assert.equal(operation.operation_type, index === 0 ? 'correction' : 'translation');
        const attempts = Number((await database.query('SELECT count(*) FROM klaro.stage_attempts WHERE operation_id = $1', [operation.id])).rows[0].count);
        assert.equal(attempts, index === 0 ? 2 : 1);
        assert.deepEqual(payload.results.map(result => result.language), index === 0 ? [activeWritingLanguage, nativeLanguage] : index === 1 ? [activeWritingLanguage] : [nativeLanguage]);
      }
      const profile = (await database.query('SELECT native_language, active_writing_language, style, proficiency FROM klaro.user_preferences WHERE user_id = $1', [setup.userId])).rows[0];
      assert.deepEqual(profile, { native_language: nativeLanguage, active_writing_language: activeWritingLanguage, style, proficiency });
      cases.push({ nativeLanguage, activeWritingLanguage, style, proficiency, operations: 3, providerAttempts: 4, inclusiveLimit: maximum, overlongBlocked: true, selectionOnly: true, swapPreservesProfile: true, staleCopyBlocked: true });
      await click('Вийти');
      await until(async () => (await readUi()).areas[0] === '', 'logout cleanup');
      console.info(`${browser}/${surface} matrix ${nativeLanguage}/${activeWritingLanguage}/${style} passed`);
    }
    await mkdir('docs/evaluations/browser-matrix', { recursive: true });
    await writeFile(`docs/evaluations/browser-matrix/${browser}-${surface}.json`, `${JSON.stringify({ testedAt: new Date().toISOString(), browser, version, surface, provider: 'double', realModelEvaluation: false, cases }, null, 2)}\n`);
  } finally {
    for (const user of users) { const keys = await redis.keys(`klaro:payload:${user}:*`); if (keys.length) await redis.del(keys); await database.query('DELETE FROM klaro.users WHERE id = $1', [user]); }
    await sessions.close();
  }
}
