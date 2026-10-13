# Імпорт довідника

Погоджене джерело: English Wiktionary через raw Wiktextract / Kaikki, ліцензія CC BY-SA 4.0. Імпортуються лише `uk/de/en/vi`. Ліцензія джерела покриває словниковий текст; приклади допускаються лише за перевіреним evidence для точного content hash. Невизначені приклади та quotations пропускаються, media не імпортуються. Причини є в `coverage.exclusions`. Особисті тексти не використовуються.

## Ручний запуск

```sh
npm run db:migrate
npm run build:reference
npm run start:import -- import --manifest=reference/sources/kaikki-en.json --file=dist/reference-data/raw-wiktextract-data.jsonl.gz --report=docs/reference-full-coverage.json
npm run start:import -- validate --release=<release-id>
npm run start:import -- activate --release=<release-id>
```

Завантажений gzip зберігається в ignored `dist/reference-data/`; SHA-256 має бути зафіксований у manifest. Mutable download URL не визначає версію: manifest містить dump / extraction revision та контрольну суму конкретного архіву. Для оновлення завантажити новий архів, перевірити metadata, зафіксувати revision і checksum та повторити команди. Не змінювати manifest уже створеного release. Імпорт читає JSONL потоком із лімітом одного запису 32 MiB й транзакційними пакетами; повторний запуск відтворює stable IDs без дублів. До validation та activation нова версія недоступна, попередня залишається активною. Видалені записи відсутні після перемикання на новий release.

## Щомісячна перевірка

```sh
npm run start:import -- check --manifest=reference/sources/kaikki-en.json --if-due=true
```

Приклад cron для deployment оператора (змінити абсолютний шлях під середовище):

```cron
0 6 1 * * cd /home/vitalik/Projects/klaro && /usr/bin/node --env-file-if-exists=.env dist/reference-import/main.js check --manifest=reference/sources/kaikki-en.json --if-due=true
```

Перевірка metadata не імпортує неперевірену нову версію автоматично. `changed=true` повідомляє про зміну джерела; повторний запуск раніше 28 днів не робить мережевий запит. Прапорець зберігається для оператора до перевірки нового manifest. Cron не встановлюється агентом у системний crontab.

## Відкликання і rollback

```sh
npm run start:import -- takedown --source=kaikki-enwiktionary --hash=<fragment-sha256> --reason=rights-revoked
npm run start:import -- takedown --source=kaikki-enwiktionary --native-key=<native-key> --reason=rights-revoked
npm run start:import -- rollback --release=<previous-validated-release-id>
npm run start:import -- revoke-source --source=kaikki-enwiktionary
```

Tombstones діють незалежно від активної версії: rollback не повертає відкликаний фрагмент. Консервативно приховується весь запис, який містить відкликаний фрагмент. Відкликання джерела забороняє повторну активацію всіх його releases. Не видаляти tombstones під час restore. Запити клієнтів використовують лише `admitted_lexical_entries`; не читати staging напряму.

## Перевірки

`npm run test:reference` перевіряє чотири мови, омоніми, POS, регулярні / нерегулярні / separable verbs, службові слова, ліцензійні пропуски, staging crash, повторний імпорт, atomic activation, removals, rollback та monthly check. `docs/reference-sample-coverage.json` містить звіт синтетичного fixture, який не є реальним coverage dataset. Production CLI не дозволяє test-only synthetic source.

## Перший повний локальний імпорт

2026-10-09 активовано release `370990cd-2e01-4526-a8fc-0dc9a3a3d5aa`: 1 975 850 entries, 2 564 332 senses, 245 152 translations, 5 652 067 forms, 10 437 401 source fragments. Мовні entries: de 371 260, en 1 492 830, uk 59 864, vi 51 896.

Приклади: 0 імпортовано; 158 176 невизначених і 658 964 неперевірених quotations пропущено за погодженим правилом. Media / sounds не імпортувалися. Переклади цього конкретного English-edition extract є лише для англійських записів (en→de/uk/vi); для інших мов доступні англомовні glosses, а missing native translation показується явно. Це не обіцянка однакового coverage усіх мов.

`npm run verify:reference` перевірив 0 неповних provenance fragments і 60 запитів за словом / формою: median ~0,96 ms, p95 ~1,67 ms на локальному PostgreSQL. Це service-level вимір, без HTTP / browser / network latency. Повні звіти: `reference-full-coverage.json` та `reference-full-verification.json`.
