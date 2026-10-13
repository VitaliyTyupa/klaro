# Design

## Context

Мотивація й обсяг: [proposal.md](proposal.md). На 2026-09-18 у репозиторії немає прикладного коду, package manifest, міграцій або тестів; `openspec list --specs` повернув порожній список. Тому структура нижче — запропонована, не опис уже наявних компонентів. Наявні `.agents/`, `.idea/` та `openspec/config.yaml` не змінюються цією планувальною роботою.

Вимоги охоплюють чотири мови, три браузери, вебклієнт і довідник; це поетапний план платформи, а не обіцянка одномоментного малого MVP. Перший наскрізний результат — корекція з автоматичним перекладом рекомендації, хоча самостійний перекладач реалізується наступним етапом.

## Goals / Non-Goals

**Goals:**

- Спільні клієнтські сценарії без залежності доменної логіки від браузера чи транспорту.
- Один контрольований backend і одна система обліку для всіх AI етапів.
- Розділення канонічного довідника, AI supplements і приватних текстів.
- Перевірювані релізи та можливість заміни provider / model policy без клієнтського оновлення.

**Non-Goals:**

- Мікросервісна інфраструктура, довільний графічний workflow builder, автономні агенти й доступ моделі до інструментів.
- Гарантія exactly-once виконання в зовнішнього провайдера за невідомого результату мережевого виклику.
- Єдина універсальна граматична схема, яка примусово моделює всі мови як німецьку.
- Фонові jobs для добування слів із приватних текстів; майбутні модулі не отримують таблиць, дозволів або endpoint-ів зараз.

## Decisions

### 1. Modular monolith and shared clients

Запропонована структура TypeScript workspace:

```text
apps/
  web/                 Angular + Material
  extension/           Angular + Material + browser adapters
  api/                 NestJS
  reference-import/    batch import entry point
packages/
  contracts/           versioned DTOs and validation schemas
  editor/              shared editor components and state
  language-profiles/   supported features and locale labels
  testing/             synthetic fixtures and provider doubles
```

NestJS modules: `Identity`, `Preferences`, `Operations`, `Usage`, `Correction`, `Translation`, `Lexicon`, `AiGateway`, `Privacy`. REST controllers і Socket.IO gateway викликають ті самі application services; [NestJS підтримує gateway abstraction](https://docs.nestjs.com/websockets/gateways). Database й provider SDK не експортуються в клієнтські пакети. Importer — окремий batch process із тим самим доменним контрактом, не окремий online service.

Альтернатива — окремі сервіси під кожну функцію — збільшує витрати розгортання й ускладнює облік без поточної потреби. Версії Angular, Material, NestJS, Node.js та package manager фіксуються сумісним набором у першому implementation task, а не вигадуються як «найновіші» в плані. UI збирається AOT, assets локальні, без remote script loaders.

### 2. Manual workspace and proposed defaults

Підтверджені продуктом правила: ручний copy/paste, 5000 символів у панелі, три області коректора й дві перекладача, `uk` / `de` за замовчуванням, мовний каталог `uk/de/en/vi`, відсутність non-native ↔ non-native перекладу.

Робочі параметри нижче — запропоновані початкові defaults для перегляду, а не раніше погоджені користувачем числові вимоги:

| Parameter | Proposed default | Reason |
|---|---|---|
| Web input limit | 20000 Unicode code points | Більше за панель, але обмежено для latency / cost |
| Live processing | Opt-in, debounce 1000 ms | Явний контроль запитів; зміни лише всередині Klaro |
| Alternatives | До 3 на одну дію | Обмежений dropdown і прогнозовані витрати |
| Original drafts | До 10 у memory поточної сесії | Відновлення наміру без постійної історії |
| Result recovery | До 15 хв після завершення, абсолютна межа payload 30 хв | Reconnect без постійного збереження тексту |
| Idempotency metadata | 24 години без тексту | Захист від повторного приймання після expiry результату |
| Provider stage timeout | 90 секунд; до 240 секунд на workflow | Обмежене виконання без нескінченного очікування |
| Initial style / level | `neutral`; рівень не заданий | Не нав'язувати спрощення тексту |

Ліміт code points однаковий у UI / API; selection offsets описуються окремо в UTF-16 для browser editor і перевіряються відносно оригіналу, включаючи surrogate pairs. Selection із режимом `selection` зберігається при переході фокусу на кнопку; без selection використовується `document`. Не весь контекст мусить іти моделі: selected text плюс найближчі абзаци в межах контекстного бюджету, із видимим індикатором використаного контексту. Для всього вводу до web limit — один bounded text workflow; якщо token budget моделі недостатній, запит відхиляється без мовчазного обрізання. Автоматичне chunking великих документів поза першою версією.

Сесія пов'язана з редактором Klaro, а не зі сторонньою вкладкою. Стара ідея очищення при навігації стороннього сайту більше не застосовується після відмови від page observation. Закриття панелі, навігація з вебредактора, reload, sign-out або «Очистити» завершують локальну сесію. Pending debounce скасовується; активні calls скасовуються best effort, payload очищається одразу після завершення при отриманому сигналі закриття, інакше за TTL. Перехід між сторонніми вкладками сам по собі не читається і не очищає панель.

`EditorSession` тримає `revisionId`, input, selection, preferences snapshot і originals у memory, без localStorage, IndexedDB, browser sync чи URL. Копіювання — explicit clipboard write з fallback на ручне виділення. Немає автоперенесення навіть між панеллю й вебредактором. Сайтова деактивація більше не потрібна; замість неї — pause роботи редактора / live mode.

### 3. Language profiles and correction composition

`LanguageProfile` описує підтримувані стилі, grammar sections та правила нормалізації конкретної мови. `nativeLanguage`, `writingLanguages`, `activeWritingLanguage` не дорівнюють UI locale. Перший UI locale — український; тексти допомоги і пояснення використовують основну мову за наявності відповідної операції. Ідентифікатори, коментарі коду й test names — англійською, обговорення та описові документи — українською.

`CorrectionResult` містить вихідну ревізію, рекомендований текст, warnings і групи правок із перевіреними spans. Застосування / відхилення змінює локально recommendation, не input. Перекривні правки групуються; перефразування може бути одним цілісним блоком, а не удаваним набором незалежних замін. Після зміни recommendation створюється новий `recommendationId`; back translation попереднього ID не відображається. Захищені spans перевіряються після генерації, а не лише згадуються в prompt. Власні захищені терміни живуть у сесії, не перетворюються на персональний словник.

Alternative generation і explanation — окремі bounded operations з parent reference та snapshot тексту від клієнта, якщо попередній payload вже expired. Автоматичний back translation — тільки для обраної завершеної recommendation, не для всіх альтернатив і не для streaming chunks. Структурований результат публікується після валідації; спочатку можна показувати stage progress без token streaming.

Уточнення користувача від 2026-10-13: якщо правок немає, результатом є оригінал. «Ще варіанти» отримує набір із щонайбільше трьох альтернатив і показує їх по черзі; після вичерпання набору кнопка недоступна. Перебір не запускає повторну генерацію альтернатив. Початковий мовний результат прийнято для старту; невирішені зауваження збережено в `docs/evaluations/initial-acceptance-and-follow-ups.md` для подальшої розробки. Автоматичне мовне оцінювання доповнюється добровільним feedback і ручним розбором спірних випадків.

Активація підтримує окремий `initial-acceptance-v1` evaluation record із явним прийняттям власником проєкту. Offline export перевіряє звіти та їх відповідність запису прийняття й документу зауважень; нова версія policy зберігає фактичні результати contract/language gate. Registry перевіряє matching model/prompt versions і структуру acceptance, як для інших адміністративних evaluation records. Прийняття не змінює runtime result validation, provider budgets або operator kill switch. Інструкція й межі активації — `docs/evaluations/production-policy-activation.md`.

### 4. Operation protocol and reliability

Socket.IO обрано для кореляції подій і спільної NestJS integration, REST залишається повноцінним interface. Socket.IO сам по собі не гарантує доставку кожної події: [delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/). Тому reconnect відновлює server snapshot, а не покладається лише на client event history.

```text
Web / Panel
    | REST or Socket.IO
    v
Auth --> Validate --> Reserve budget --> OperationRegistry
                                           |
                                           v
                                   WorkflowRunner
                                           |
                                           v
                                    AiProviderAdapter
                                           |
                                           v
Validate result --> Usage settlement --> Snapshot + Events
```

API `/v1`: `POST /operations`, `GET /operations/:id`, `POST /operations/:id/cancel`; `GET/PUT /me/preferences`, `GET /me/usage`, `/me/export`, `/me/deletion`; `GET /lexicon/entries` і `GET /lexicon/entries/:id/sections/:section`. AI supplements створюються через operations, а не прихованим side effect GET. Auth endpoints відокремлені від operation API.

Command envelope: `clientRequestId`, `revisionId`, `operationType`, `input`, `selection`, мовні параметри та bounded context. `userId` походить із session, не з payload. Response / event: `operationId`, `revisionId`, `stageId`, `sequence`, `status`, `resultVersion`, structured error. Events: `operation.accepted`, `stage.started`, `stage.completed`, `operation.completed`, `operation.failed`, `operation.cancelled`. HTTP повертає accepted response з resource URL; polling має bounded backoff.

Стани: `accepted`, `running`, `partially-completed`, `completed`, `failed`, `cancelled`, `indeterminate`; недоступний expired payload позначається окремо від operation outcome. Unique `(userId, clientRequestId)` і HMAC payload digest захищають повторне приймання; digest не є анонімізацією і видаляється за retention policy. Snapshot / sequence дозволяють ігнорувати дублікати. Ключ із іншим payload → conflict; expired operation → explicit expiry без replay.

Перший deployment — один API instance; long-running calls виконуються асинхронно в ньому, не в браузерному service worker. PostgreSQL зберігає operation metadata і stage attempts; Redis — тільки тимчасові payload / snapshots, без AOF, snapshots чи backup. Crash після початку provider call дає `indeterminate`, а не автоматичний повтор. До provider call повторення безпечного transport setup можливе; після невідомого результату — тільки явна нова дія з попередженням про можливу вже понесену вартість. SDK automatic retries вимикаються або підпорядковуються цій policy.

BullMQ для текстових запитів спочатку не потрібен: безумовний restart recovery вимагав би довшого зберігання приватних payload. За потреби майбутнього durable execution — окрема зміна з privacy review. Redis не використовується як єдине джерело budget truth.

### 5. PostgreSQL, budget ledger and retention

PostgreSQL обрано для транзакцій, account relations і структурованого довідника; flexible morphological features зберігаються в JSONB поруч із нормалізованими ключами. Окрема vector database не потрібна для lookup за словом / формою.

| Area | Entities | Content boundary |
|---|---|---|
| Identity | `User`, `ExternalIdentity`, `Session`, `UserPreferences` | Профіль, session hashes, налаштування |
| Operations | `Operation`, `StageAttempt`, `UsageLedger`, `BudgetReservation` | Статуси, версії, usage, без raw text |
| Reference | `LexicalEntry`, `Sense`, `Translation`, `Example`, `Inflection`, `SourceRecord`, `DatasetRelease` | Тільки ліцензовані довідкові дані |
| Supplements | `AiSupplement` | Лише безконтекстна довідка; provenance і TTL |
| Privacy | `DataRequest`, `DeletionJob`, `AuditEvent` | Мінімальні дані виконання прав і адміністрування |

Quota policy — серверна, версійована: per-user request rate, concurrent calls, daily token / cost budget, global budget, stage output cap. Перед кожним workflow транзакційно резервується консервативна верхня межа, включаючи back translation; перед викликом перевіряється доступність його частини. Settlement використовує usage провайдера, ціни з версійованої конфігурації й явні estimated / actual markers. Повторний settlement не дублює ledger. Unknown usage лишає резерв до reconciliation або обмеженого conservative settlement, не звільняє його передчасно. IP limiter — допоміжний anti-abuse, не заміна user quota.

Запропонований retention baseline: operation / usage detail і security logs — до 30 днів; необов'язкова аналітика поведінки не збирається. Account data — до видалення; temporary private text — до меж із таблиці defaults, не потрапляє в PostgreSQL / backups. Account deletion одразу відкликає сесії, забороняє нові операції й запис пізніх результатів, очищає активні сховища до 7 днів; encrypted backups — до 30 днів із повторним застосуванням deletion tombstones під час restore. Будь-які законні винятки документуються окремо перед release. Ці строки — проектні defaults для privacy review, не висновок про юридичну достатність.

### 6. Authentication and client security

Використати OIDC Authorization Code з PKCE (`S256`), `state`, `nonce` та allowlisted redirect URIs; backend перевіряє issuer, audience й одноразове завершення flow. Конкретний OIDC provider залишається deployment configuration. Власна password database та password-reset workflow не додаються.

Вебклієнт використовує same-origin BFF / secure HttpOnly session cookie, CSRF defense і перевірку Origin. Розширення запускає браузерний auth flow через `identity` adapter, отримує лише короткий application session token; він живе в memory / session-scoped browser storage, не sync і не persistent local storage. Browser restart може вимагати повторного входу. Provider refresh tokens не видаються Angular client; backend session rotation / revocation тестується окремо. Socket handshake і кожна команда авторизуються; expired session від'єднується, client не задає room інших користувачів. CORS / Origin allowlist лише додатковий бар'єр.

Усі credentials — server secrets, redaction застосовується також до reverse proxy, traces, exception reporting і job logs. Браузер отримує лише sanitized structured text; шаблони не виконують HTML моделі, markdown rendering не є необхідним.

### 7. Browser packaging and lifecycle

Chrome / Edge package використовує Manifest V3 та side panel adapter; Firefox — окремий manifest і `sidebarAction` adapter. Відмінності browser APIs не ховаються за припущенням абсолютної сумісності. Офіційні описи: [Chrome sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [Edge sidebar](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/sidebar), [Firefox sidebarAction](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction).

Базові дозволи обґрунтовуються реалізованими діями: panel permission у Chromium, `identity`, `storage` за потреби session token і дозволи тільки конкретного backend origin. Немає `activeTab`, `tabs`, `scripting`, content scripts, `<all_urls>`, clipboard read, microphone чи tab capture. Copy write permission додається лише якщо потрібен для підтвердженої browser behavior; ручний fallback обов'язковий. Socket connection належить відкритому panel document, не підтримує service worker штучно живим. Фоновий adapter відповідає лише за launch / browser commands та auth.

MV3 забороняє remote executable functionality; Angular AOT bundle, fonts та icons пакуються локально, CSP не дозволяє eval. Backend models і словникові дані не є клієнтським кодом, але не можуть трактуватися як script / interpreted commands. [MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements). Пакети перевіряються на реальних current stable desktop browsers; точні протестовані версії й minimum manifest versions фіксуються в release evidence, а не обіцяються наперед.

### 8. AI provider boundary and workflows

`AiProviderAdapter` приймає нормалізований `AiTask`, повертає validated candidate, provider request ID, usage та bounded error. `ModelPolicy` містить provider, model ID, capabilities, output budget, timeout і privacy options; `WorkflowDefinition` та prompt templates версійовані. Новий vendor потребує нового adapter і contract tests, не лише підміни URL. Автоматичного fallback до іншого постачальника без disclosure немає.

Початковий adapter — OpenAI Responses API з `store: false`, без tools, persistent conversation, background mode і cross-user context. Це не означає zero retention у провайдера: окремі data controls й abuse monitoring потрібно перевірити для обраного account / deployment. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data). Model ID обирається за evals на чотирьох мовах і фіксується в configuration; неконтрольований alias `latest` не використовується.

```text
Correction --> Validate --> Publish recommendation --> Translate to native
Translation --> Validate --> Publish translation
Explain / Alternatives --> Validate --> Publish
Lexical supplement --> Validate --> Publish with AI provenance
```

Користувацький текст / словникові уривки розділяються з system policy та передаються як data; немає secrets чи інструментів, які injection міг би викликати. Schema validation, span validation, output bounds, protected-term checks і synthetic adversarial tests — захисні шари, а не доказ семантичної точності. Structured Outputs допомагає відповідності формату, але потребує обробки refusal / incomplete responses і не підтверджує правильність змісту. [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

### 9. Reference import and progressive lookup

Початковий source adapter — raw Wiktionary extracts через Wiktextract / Kaikki, які мають багатомовні записи, частини мови, значення й форми, але нерівномірне покриття. Це робить доцільним coverage report до повного імпорту, а не припущення повноти. [Wiktextract](https://github.com/tatuylonen/wiktextract), [raw datasets](https://kaikki.org/dictionary/rawdata.html).

Спочатку sample import для `de`, `en`, `uk`, `vi`, із синтетичними / ліцензійно дозволеними fixtures: регулярні й нерегулярні дієслова, відокремлювані німецькі дієслова, омоніми, іменники, прикметники та службові частини мови. Перевіряються ліцензії конкретних фрагментів, включаючи quotations і media: загальна ліцензія Wiktionary не є дозволом на всі сторонні матеріали. [Wiktionary copyrights](https://en.wiktionary.org/wiki/Wiktionary:Copyrights).

Погоджене правило імпорту: ліцензія перевіреного джерела застосовується до охоплених нею словникових даних без вимоги поля `license` у кожному записі. Приклади з невизначеними правами пропускаються, не блокуючи дозволені фрагменти того самого слова. Для examples потрібне визначене source rule або explicit evidence, прив'язане до content hash; quotations, media та суперечливі права виключаються. Причини виключення враховуються в coverage report. Суцільний ручний перегляд і автоматичний обхід source pages не входять у цей pipeline. Невідомі права самого dataset або невідомі права вже збереженого фрагмента блокують activation.

`SourceRecord` зберігає native source key, source revision, license, attribution, imported content hash. Спершу записи різних джерел не зливаються автоматично за лемою; relationships / sense mapping зберігають невизначеність. `EntrySection` використовує states зі специфікації, source availability та окремий `originKind`: `source`, `machine-translation`, `generated-unverified`. Наявність слова не гарантує перекладів усіма трьома іншими мовами.

Імпорт: allowlisted dataset download → streaming parse → staging release → validation / coverage / license checks → atomic active-release switch. Monthly scheduled check та manual запуск достатні спочатку; повторний same-version import — no-op. Нові source removals / legal takedowns відображаються в активному наборі; rollback не має повертати матеріал із відкликаними правами. Повна стара версія лишається доступною для rollback лише в межах прав та retention джерела.

dict.cc, DWDS, Verbformen, Tatoeba й OpenThesaurus не входять до автоматичного production import цієї зміни. Їх можна додати окремими adapters після перевірки конкретного dataset / delivery method. Зокрема [dict.cc download terms](https://www1.dict.cc/translation_file_request.php?l=e) не дають загального дозволу на backend republication; [DWDS headword list](https://clarin.bbaw.de/de/objects/dwds:2/) не є ліцензією на всі тлумачення DWDS. Ніякого scraping приватних / недозволених endpoint-ів.

`AiSupplement` без приватного контексту кешується на обмежений строк із ключем `entryId + senseId + section + nativeLanguage + sourceVersion + policyVersion`. Спільний кеш дозволений лише для відомого канонічного запису, коли prompt побудований із серверних джерельних даних і дозволених параметрів, без довільного тексту запиту користувача. Запити для відсутніх у базі слів та будь-які контекстні пояснення залишаються user-scoped. Запропонований TTL спільного supplement — 7 днів. При оновленні джерела доповнення інвалідується; machine-translated source content зберігає атрибуцію та застосовні ліцензійні умови. З приватним контекстом результат живе тільки у user-scoped temporary operation storage. Немає автоматичного promotion до source data. Reports про помилки спочатку містять лише record / supplement ID і причину без оригіналу особистого повідомлення.

### 10. Privacy, evaluation and release gates

Єдина мета розширення — допомога з письмовою комунікацією та розумінням слів. Не збираються browsing activity, field events і marketing analytics. User activity logging означає лише потрібні usage / reliability / security metadata. [Chrome Web Store policies](https://developer.chrome.com/docs/webstore/program-policies/policies) вимагають узгоджених disclosures, мінімальних дозволів і безпечної обробки даних; тому manifest audit і network audit — частина release evidence.

Приватність закладається в архітектуру через мінімізацію та строки збереження; це відповідає напряму [GDPR principles](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en), але не замінює оцінки правових підстав, DPA, subprocessors, international transfers, rights handling і потреби DPIA компетентним фахівцем. Просте відкриття панелі чи `store: false` не вважається універсальним consent / compliance механізмом.

Release gates: no known critical security findings; усі contract / isolation / quota / lifecycle tests проходять; ручний browser smoke test усіх трьох пакетів; словникові attribution checks; контрольні мовні набори для всіх активних мов і напрямків. Мовні evals включають збереження заперечень, чисел, обіцянок, protected terms і правильність форм; back translation не використовується як єдиний quality oracle. Model / source updates проходять той самий regression gate із можливістю rollback.

## Risks / Trade-offs

- [Чотири мови мають різну якість корекції й покриття довідника] → окремі eval / coverage reports; missing states замість вигаданої повноти; реліз заявленої мови лише після перевірки.
- [LLM помиляється в точній морфології] → source-first, явне маркування, report issue, відсутність canonical promotion.
- [Live mode та back translation збільшують витрати] → opt-in debounce, дедуплікація, резерв workflow budget, обмежені альтернативи.
- [Memory-only private payload втрачається при рестарті] → явний interrupted / indeterminate стан; client draft лишається тільки доки сесія відкрита; не обіцяти durable job recovery.
- [Redis / PostgreSQL не мають спільної транзакції] → reservation / operation metadata спочатку в PostgreSQL; невдала публікація payload не запускає provider, reconciliation прибирає orphan reservations.
- [OIDC provider і browser store мають різні flows / вимоги] → один auth contract, browser-specific adapters і перевірка реальних пакетів.
- [Ліцензії джерел накладають різні умови] → provenance на рівні фрагмента, license admission, виключення сумнівних даних.
- [Закриття panel document не завжди дає надійний unload signal] → cancel best effort плюс TTL, без обіцянки миттєвого видалення у провайдера.

## Migration Plan

Greenfield deployment, міграції існуючого користувацького коду не потрібні.

1. Створити workspace, contracts, CI, базові клієнти, Identity / Preferences, PostgreSQL migrations і ephemeral Redis configuration.
2. Додати operation protocol, quota ledger, provider adapter і test double; спочатку staging без реальних приватних текстів.
3. Завершити наскрізну корекцію разом із back translation в Chrome panel та web, потім browser parity для Edge / Firefox.
4. Додати самостійний переклад та перевірити всі дозволені мовні пари.
5. Виконати sample import / license gate, імпорт першого довідника, progressive lookup й AI supplements.
6. Пройти security / privacy / language / browser gates, підготувати store packages і disclosures. Реальна публікація та створення платних ресурсів потребують окремої авторизації власника.

Rollback: попередні application images і additive database migrations; provider policy rollback без клієнтського релізу; active dataset pointer rollback із license checks; глобальне вимкнення AI operations без видалення usage ledger. Backups тестуються на restore із повторним застосуванням account deletion tombstones. Downgrade database schema з втратою даних не є стандартним rollback.

## Open Questions

До deployment можна без зміни контрактів обрати OIDC vendor, hosting region / provider, конкретні model IDs після evals, квоти для початкової групи користувачів і домени / store IDs. Вони задаються конфігурацією та входять до відповідних задач перевірки; це не дозвіл створювати зовнішні акаунти або оплачувані ресурси під час планування.
