# Privacy / licensing review package

Дата: 2026-10-13. Статус: **пакет підготовлено; юридичний release sign-off відсутній, публічний випуск заблокований до операторської перевірки перелічених умов**. Початкове прийняття model policy не є legal sign-off. Цей документ описує фактичну реалізацію та відкриті deployment-питання, а не висновок про автоматичну відповідність законам.

## Карта даних і строки

| Дані | Обробка / місце | Строк / процедура |
| --- | --- | --- |
| Account, OIDC identity, preferences | Backend PostgreSQL; OIDC provider для входу | До видалення акаунта; session expiration/revocation. Назву OIDC provider визначає deployment. |
| Оригінал, selection/context, recommendation, translation | Memory клієнта, приватний scoped Redis; потрібний stage input передається OpenAI | Redis максимум 30 хв, після завершення до 15 хв у цій межі; memory очищається при clear/logout/close. Немає постійної текстової історії, приватних текстів у DB backup або shared cache. |
| Operation/stage/usage metadata, feedback category | PostgreSQL без raw text | 30 днів; feedback добровільний, без вільного коментаря; експорт та account deletion охоплюють feedback. |
| Idempotency HMAC | PostgreSQL без тексту | 24 год; ключ — серверний secret. Не подавати HMAC як анонімізацію. |
| Public lexical data / queries | Канонічний довідник із provenance; явний lookup | Source updates/takedowns; queries не створюють персонального словника. |
| Context-free AI supplement | Окремий кеш із source/policy versions | 7 днів; приватний контекст і unknown-entry queries не додаються до shared cache. |
| Tombstone / encrypted deletion journal | Backend і окремий encrypted журнал | 35 днів; restore лише offline із повторним застосуванням видалень, для backup віком до 30 днів. |

Evidence: [privacy operations](../privacy-operations-verification.md), [recovery runbook](../deployment-recovery-runbook.md), `tests/privacy.integration.mjs`, `tests/proxy-privacy.integration.mjs`, `apps/api/src/privacy/config.ts`.

## Правові підстави — для підтвердження оператором

Account/auth, налаштування та запитані мовні операції: запропонована підстава — виконання договору на послугу. Security/usage/anti-abuse metadata: оператор має визначити підставу, необхідність і пропорційність. Для voluntary feedback визначити підставу, мету та порядок відкликання/видалення. First-send disclosure і кнопка згоди в UI самі по собі не встановлюють юридичну підставу для кожного виду обробки. Не підтримувати спеціальні категорії або дитячі акаунти без окремої перевірки. Приватний текст може містити дані третіх осіб; це треба врахувати в terms/disclosure.

Оператор має затвердити controller name/address/contact, privacy/support URLs, перелік цілей/підстав, процедури доступу, виправлення, видалення, обмеження/заперечення та строк відповіді; UI export/deletion покривають лише технічну частину. Jurisdiction/applicability і тексти повідомлень погоджує відповідальний reviewer; [офіційний текст GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng) є джерелом для такої перевірки.

## Processor contracts, regions і provider controls

Заплановані сторони: оператор Klaro, hosting/database/backup service, OIDC provider, OpenAI. Hosting та OIDC ще не обрані; не вигадувати їхні назви, регіони чи підписані договори. Перед запуском зафіксувати фактичний список subprocessors, договори, locations і механізми international transfers, якщо вони потрібні, разом із reviewer decision.

Для OpenAI звірити застосовність [DPA](https://openai.com/policies/data-processing-addendum/) до конкретного account і договору, доступні regions/data controls і subprocessors. [Data controls](https://developers.openai.com/api/docs/guides/your-data) відрізняють application state від abuse monitoring: `store:false` не означає zero retention; стандартні abuse logs можуть зберігатися до 30 днів із винятками. Account-specific retention тут не підтверджено. Вписати перевірені умови в `PROVIDER_RETENTION_NOTICE` та синхронізувати privacy page/store disclosures. Requests у коді foreground, без tools/conversations; credentials лише server-side.

## Джерельні ліцензії

Клієнтські dependency notices генерує Angular у `3rdpartylicenses.txt`; extension packager включає цей файл у кожний браузерний пакет, recursive audit перевіряє його наявність. Права на власний код, бренд/logo та інші distribution assets оператор має підтвердити окремо; source-data license не є ліцензією всього застосунку.

Source manifest: `reference/sources/kaikki-en.json`; попередній [admission review](../reference-source-admission-review.md), [full import evidence](../reference-full-verification.json). Допущено English Wiktionary raw extract через Kaikki/Wiktextract із filtering `uk/de/en/vi`, pinned revision/checksum. Media, сторонні quotations та невизначені examples виключаються; dict.cc/DWDS не імпортуються.

Attribution: **Wiktionary contributors; extracted by Wiktextract / Kaikki (Tatu Ylonen). Klaro filters and normalizes the source data.** Зберігаються source/article URL, revision, license URL і позначка перетворення. [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) передбачає attribution, позначення змін і ShareAlike для поширюваних адаптацій. [Wikimedia terms](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use) та конкретне provenance визначають прийнятність матеріалів. Reviewer має підтвердити форму публічного розповсюдження й виконання ShareAlike; source admission не підміняє цей висновок. AI supplements залишаються окремими й не підвищуються автоматично до canonical facts.

## Рішення та блокери публічного випуску

Legal reviewer/sign-off: **не призначений / не отримано**. Публічний release заблокований, доки не визначені operator/contact і vendors/regions, не перевірені legal bases, contracts/transfers/provider retention, public notices та остаточне license attribution/distribution. Це явний release blocker відповідно до задачі 11.4; технічна підготовка review package завершена. Документ не доручає надсилати матеріали третім особам або купувати legal review.
