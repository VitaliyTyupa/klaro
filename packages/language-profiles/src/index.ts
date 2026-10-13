export const SUPPORTED_LANGUAGES = ['uk', 'de', 'en', 'vi'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export { UK_UI } from './locales/uk';

export interface LanguageProfile {
  language: Language;
  styles: readonly ['neutral', 'formal'];
  proficiencyLevels: readonly ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  addressForms: { neutral: string; formal: string };
}

const styles = ['neutral', 'formal'] as const;
const proficiencyLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export const LANGUAGE_PROFILES: Record<Language, LanguageProfile> = {
  uk: { language: 'uk', styles, proficiencyLevels, addressForms: { neutral: 'context-sensitive', formal: 'respectful-address' } },
  de: { language: 'de', styles, proficiencyLevels, addressForms: { neutral: 'du', formal: 'Sie' } },
  en: { language: 'en', styles, proficiencyLevels, addressForms: { neutral: 'natural-register', formal: 'formal-register' } },
  vi: { language: 'vi', styles, proficiencyLevels, addressForms: { neutral: 'context-sensitive-pronouns', formal: 'respectful-context-sensitive-pronouns' } },
};
