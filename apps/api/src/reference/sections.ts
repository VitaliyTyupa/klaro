import type { ReferenceLanguage, ReferenceSection } from '@klaro/contracts';
export function applicableSections(language: ReferenceLanguage, pos: string): ReferenceSection[] {
  const common: ReferenceSection[] = ['definitions', 'translations', 'examples'];
  if (language === 'vi') return [...common, 'usage'];
  if (language === 'de' && pos === 'verb') return [...common, 'infinitive-participle', 'indicative', 'subjunctive', 'imperative'];
  if (pos === 'noun' || pos === 'name') return language === 'en' ? [...common, 'plural', 'forms', 'usage'] : [...common, 'gender-article', 'plural', 'declension'];
  if (pos === 'adj') return language === 'en' ? [...common, 'comparison', 'usage'] : [...common, 'comparison', 'declension'];
  if (pos === 'pron' || pos === 'article' || pos === 'det') return [...common, 'forms'];
  if (pos === 'adv') return [...common, 'usage'];
  if (['prep', 'postp', 'conj', 'particle', 'intj'].includes(pos)) return [...common, 'usage'];
  if (pos === 'verb') return [...common, 'forms', 'usage'];
  return common;
}
export function matchesSection(section: ReferenceSection, tags: string[]): boolean {
  const has = (...values: string[]): boolean => values.some(tag => tags.includes(tag));
  switch (section) {
    case 'infinitive-participle': return has('infinitive', 'participle');
    case 'indicative': return has('indicative');
    case 'subjunctive': return has('subjunctive', 'subjunctive-i', 'subjunctive-ii');
    case 'imperative': return has('imperative');
    case 'plural': return has('plural');
    case 'declension': return has('nominative', 'accusative', 'dative', 'genitive', 'instrumental', 'locative', 'vocative');
    case 'comparison': return has('comparative', 'superlative');
    case 'gender-article': return has('masculine', 'feminine', 'neuter', 'article');
    default: return true;
  }
}
