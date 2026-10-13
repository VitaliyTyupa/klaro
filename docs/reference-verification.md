# Перевірка довідника

Source import policy: автоматичний допуск словникових фрагментів за погодженою ліцензією джерела; приклади без перевіреного evidence пропускаються. Канонічні записи й ШІ-доповнення зберігаються окремо.

## API

Усі endpoints вимагають активної сесії. Запити до джерела не створюють персональний словник і не запускають ШІ.

- `GET /v1/reference/lookup?language=de&query=ging`: кандидати з окремими IDs, POS, homonym key та immutable release UUID; є pagination для великої неоднозначності.
- `GET /v1/reference/entries/:id?sourceVersion=<uuid>&nativeLanguage=uk`: до п’яти значень і двох прикладів на значення; наступні значення через `offset`. Непов’язані source translations залишаються окремими.
- `GET /v1/reference/entries/:id/sections?sourceVersion=<uuid>`: застосовні секції та їх availability.
- `GET /v1/reference/entries/:id/sections/:section?sourceVersion=<uuid>`: незалежне завантаження source section, `available` / `missing` / `not-applicable`; мережеві помилки показуються окремо на клієнті.
- `GET /v1/reference/supplements?...`: доповнення лише для активного дозволеного запису, потрібного section / sense, мови, style / proficiency та поточної model / prompt / workflow policy. TTL — сім днів. Джерельні дані мають пріоритет; інша source version, takedown або policy не відкривають старий cache.
- `POST /v1/reference/reports`: CSRF-protected strict JSON із `targetId`, `targetKind`, enum `reason`; максимум п’ять повідомлень за 24 години. Поля особистого тексту заборонені. Для uncached приватного доповнення використовується ID власної lexical operation; чужий operation ID не допускається.

Явні `lexical-supplement` і `source-translation` використовують наявний operation pipeline із quota reservations, usage ledger, refusal / timeout handling. Backend розв’язує canonical ID / version / sense / section і бере вихідний текст із джерела. Клієнтський довільний `input` не замінює sourced content. Непридатні секції відхиляються. Генерація заборонена, якщо для обраної секції / значення вже є джерельні дані. Невідоме слово має лише окрему неперевірену довідку, без canonical insert і shared cache.

## Клієнт

Окрема web view `/reference` та явна кнопка над selection у власному редакторі. Немає page reads або word harvesting з correction / translation. Source section cache є лише в пам’яті, обмежений 200 записами й прив’язаний до ID / release / section; очищається при logout. HTML джерела не інтерпретується. Native `details/summary` підтримують клавіатуру; після transport error показується «Повторити», без автоматичного AI запиту.

Машинний переклад джерела та неперевірене доповнення мають різні labels. Приватний контекст передається лише явним AI action і не записується в shared cache. Відсутній переклад основною мовою показується явно; його можна отримати окремою AI action. Provenance URL / revision / attribution / license доступні для значень, перекладів, прикладів і граматичних items.

## Відтворення перевірок

- `npm run test:reference`: PostgreSQL / Redis integration для import lifecycle, lookup, homonyms, inflections, NFC / accents, missing native translations, sense association, AI accounting, refusal, cache TTL / policy / source precedence / privacy, report limits.
- `npm run test:reference-ui`: Chrome 154.0.8037.57; disambiguation, lazy loading, keyboard open, transport retry, missing states, різні AI labels, ID-only reports, selection без приватного решти абзацу, Axe без serious / critical findings.
- `npm test`: unit contracts, cache/version separation, source admission, пошкоджений gzip / JSONL та чинні editor / operations checks.

Цей файл описує реалізацію та команди перевірки. Full dataset evidence зберігається окремо у `reference-full-coverage.json`; синтетичний sample не підтверджує реальне мовне coverage або якість моделі.
