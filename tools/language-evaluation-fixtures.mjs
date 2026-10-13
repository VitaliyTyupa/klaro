import { readFileSync } from 'node:fs';
import { OperationCommandSchema, DEFAULT_PREFERENCES } from '@klaro/contracts';

export const LANGUAGES = ['uk', 'de', 'en', 'vi'];
export const REVIEW_CRITERIA = ['grammar', 'meaning', 'facts', 'numbers', 'negation', 'commitment', 'style', 'protected-terms', 'ambiguity'];
export const FIXTURE_VERSION = 'synthetic-full-language-v1';
const base = JSON.parse(readFileSync(new URL('../packages/testing/fixtures/language-regression.json', import.meta.url), 'utf8'));
const grammar = {
  uk: ['Вона надіслав лист учора.', 'Вона надіслала лист учора.'],
  de: ['Sie haben gestern den Brief geschickt.', 'Sie hat gestern den Brief geschickt.'],
  en: ['She have sent the letter yesterday.', 'She sent the letter yesterday.'],
  vi: ['Cô ấy gửi đã bức thư hôm qua.', 'Cô ấy đã gửi bức thư hôm qua.'],
};
// The German context below establishes a singular female referent, not formal Sie.
const contexts = { uk: 'Ідеться про одну жінку.', de: 'Mit Sie ist eine einzelne Frau gemeint, keine höfliche Anrede.', en: 'The subject is one woman.', vi: 'Chủ ngữ là một người phụ nữ.' };
const selected = { uk: 'Він сказав, що вона готова.', de: 'Er sagte, dass sie bereit sei.', en: 'He said she was ready.', vi: 'Anh ấy nói cô ấy đã sẵn sàng.' };

function makeCase(id, operationType, sourceLanguage, targetLanguage, text, style = 'neutral', extra = {}) {
  const nativeLanguage = ['translation', 'source-translation'].includes(operationType) ? targetLanguage : sourceLanguage === 'uk' ? 'de' : 'uk';
  const writingLanguage = sourceLanguage;
  const proficiency = style === 'formal' ? 'B2' : 'A2';
  const { protectedTerms = [], ...options } = extra;
  const command = OperationCommandSchema.parse({
    version: 'v1', clientRequestId: id, revisionId: id, operationType, surface: 'web', input: text,
    selection: { scope: 'document' }, sourceLanguage, targetLanguage,
    preferences: { ...DEFAULT_PREFERENCES, nativeLanguage, writingLanguages: [writingLanguage], activeWritingLanguage: writingLanguage, style, proficiency },
    protectedSpans: protectedTerms.map(term => ({ start: text.indexOf(term), end: text.indexOf(term) + term.length })), ...options,
  });
  return { id, command, reviewCriteria: REVIEW_CRITERIA };
}

export function evaluationFixtures() {
  const cases = base.cases.map(f => makeCase(f.id, 'correction', f.language, f.language, f.input, f.style, { protectedTerms: f.protectedTerms }));
  for (const language of LANGUAGES) {
    cases.push(makeCase(`${language}-grammar`, 'correction', language, language, grammar[language][0], 'neutral', { context: contexts[language] }));
    for (const target of LANGUAGES.filter(l => l !== language)) {
      for (const style of ['neutral', 'formal']) {
        const text = base.cases.find(f => f.language === language && f.id.endsWith('negation')).input;
        cases.push(makeCase(`translate-${language}-${target}-${style}`, 'translation', language, target, text, style, { protectedTerms: ['ABC-123'] }));
      }
    }
    for (const style of ['neutral', 'formal']) {
      const text = selected[language];
      const input = `${contexts[language]}\n${text}`;
      const start = input.indexOf(text);
      cases.push(makeCase(`paraphrase-${language}-${style}`, 'paraphrase', language, language, input, style, { selection: { scope: 'selection', start, end: start + text.length }, context: contexts[language] }));
      const fact = base.cases.find(f => f.language === language && f.id.endsWith('facts'));
      cases.push(makeCase(`alternatives-${language}-${style}`, 'alternatives', language, language, fact.input, style, { protectedTerms: fact.protectedTerms }));
      const native = language === 'uk' ? 'de' : 'uk';
      cases.push(makeCase(`explain-${language}-${style}`, 'explanation', language, native, grammar[language][0], style, { parent: { operationId: `parent-${language}`, recommendationId: `rec-${language}` }, recommendation: { recommendationId: `rec-${language}`, text: grammar[language][1] }, context: contexts[language] }));
    }
    const words = { uk: 'лист', de: 'Brief', en: 'letter', vi: 'thư' };
    cases.push(makeCase(`lexical-${language}`, 'lexical-supplement', language, language, words[language], 'neutral', { lexical: { section: 'overview' } }));
    // Synthetic source fragments, not imported/private content; each target language is covered.
    const source = language === 'en' ? 'de' : 'en';
    const gloss = source === 'en' ? 'A written message sent to a recipient.' : 'Eine schriftliche Nachricht an einen Empfänger.';
    cases.push(makeCase(`source-${language}`, 'source-translation', source, language, gloss, 'neutral', { lexical: { entryId: `synthetic-${source}`, sourceVersion: 'synthetic-source-v1', section: 'overview' } }));
  }
  return cases;
}
