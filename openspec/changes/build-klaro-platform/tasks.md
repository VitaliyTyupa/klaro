# Tasks

## 1. Workspace Foundation

- [x] 1.1 Створити TypeScript workspace зі структурою `apps/web`, `apps/extension`, `apps/api`, `apps/reference-import` і shared packages з design; зафіксувати сумісні версії Node.js, Angular, Material, NestJS та package manager; перевірити чисте встановлення, typecheck і production build порожніх застосунків.
- [x] 1.2 Додати lint, unit-test і CI commands та правила меж client/server packages; перевірити, що клієнтський імпорт server-only module блокується й CI виконується на чистому checkout.
- [x] 1.3 Додати український development README та правила англійських identifiers / code comments, локалізовані UI resources; перевірити documented setup і відсутність user-facing текстів у технічних enum values.
- [x] 1.4 Підготувати локальні PostgreSQL і Redis без persistence для приватних payload, migrations runner і приклад environment без секретів; перевірити healthchecks, fresh database migration і Redis restart без відновлення текстів.
- [x] 1.5 Створити спільні версійовані contracts для language preferences, commands, events, results та structured errors; перевірити schema tests для invalid enum, overlong input, selection bounds і додаткових заборонених полів.

## 2. Identity and Preferences

- [x] 2.1 Додати міграції `User`, `ExternalIdentity`, `Session`, `UserPreferences`; перевірити unique constraints і ізоляцію даних між двома test users.
- [x] 2.2 Реалізувати OIDC code flow з PKCE, state, nonce та allowlisted callbacks через configurable provider; перевірити з локальним test provider успішний login, replay, invalid issuer / audience і підміну redirect URI.
- [x] 2.3 Реалізувати web session cookie, CSRF checks, sign-out та session revocation; перевірити cookie flags і відмову для expired / revoked sessions.
- [x] 2.4 Реалізувати extension auth handoff з одноразовим code exchange та коротким application session token без persistent local / sync storage; перевірити повторне використання code й очищення токена після logout / browser session end.
- [x] 2.5 Реалізувати preferences API й мовні профілі `uk/de/en/vi`, `uk/de` defaults, styles та proficiency settings; перевірити language-role matrix і заборону збігу основної та активної мови письма.
- [x] 2.6 Додати вебсторінки профілю й налаштувань та спільний quick language selector; перевірити збереження / повторне завантаження й інвалідацію результату без зміни чернетки.

## 3. Operation Contracts and Usage

- [x] 3.1 Створити metadata migrations для `Operation`, `StageAttempt`, `UsageLedger`, `BudgetReservation`; перевірити відсутність raw text columns, uniqueness idempotency keys і повторного settlement.
- [x] 3.2 Реалізувати спільний operation application service, REST endpoints і Socket.IO gateway з однаковою validation / authorization; перевірити transport parity та cross-account access tests.
- [x] 3.3 Додати accepted acknowledgements, sequence events і snapshot endpoint; перевірити concurrent out-of-order operations, дублікати подій і reconnect без нового provider call.
- [x] 3.4 Реалізувати idempotent acceptance з payload HMAC та конфліктом ключа; перевірити lost acknowledgement, конкурентне надсилання одного ключа й повтор після expiry payload.
- [x] 3.5 Додати Redis payload storage з TTL, user scoping, explicit expiry та cleanup; перевірити, що текст не потрапляє до PostgreSQL, persistent logs або backup, і недоступний після TTL.
- [x] 3.6 Реалізувати atomic budget reservation для всіх етапів workflow та user/global concurrency limits; перевірити конкурентне вичерпання бюджету без перевищення дозволеної кількості calls.
- [x] 3.7 Додати actual / estimated usage settlement, версійовані price policies та reconciliation для orphan / unknown reservations; перевірити duplicate settlement, відсутній provider usage і timeout без передчасного повернення бюджету.
- [x] 3.8 Реалізувати stage cancellation, partial failure та crash recovery зі станом `indeterminate`; перевірити падіння до / після provider dispatch і відсутність прихованого replay.
- [x] 3.9 Додати usage API та вебпідсумки operations / provider attempts / tokens; перевірити облік корекції, back translation, explanation і retry як окремих витрат.

## 4. Provider Integration and Workflow Safety

- [x] 4.1 Реалізувати `AiProviderAdapter`, `ModelPolicy`, `WorkflowDefinition` і deterministic provider double; перевірити, що domain services не імпортують vendor SDK та працюють із double.
- [x] 4.2 Додати OpenAI Responses adapter зі server-only credentials, `store: false`, bounded timeout / output і контрольованими retries; перевірити recorded mock requests на відсутність tools, background mode й persistent conversation IDs.
- [x] 4.3 Реалізувати versioned model / prompt configuration і startup validation capabilities; перевірити відхилення несумісної policy, pinning активних operations і rollback policy.
- [x] 4.4 Реалізувати schema / span / protected-term validation та refusal / incomplete / provider-error mapping; перевірити malicious text, invalid JSON, forged offsets і незавершені відповіді без публікації фінального результату.
- [x] 4.5 Додати bounded workflow runner з cancellation між етапами; перевірити, що back translation не породжує loop, а stage failure не запускає необмежені repair calls.
- [x] 4.6 Підготувати синтетичні мовні regression fixtures для `de/en/uk/vi` та критерії перевірки фактів, чисел, заперечень, стилю й protected terms; перевірити harness на provider double та сформувати формат human review report для реальних models.

## 5. Shared Editor and Browser Shell

- [x] 5.1 Створити спільний Angular Material editor із дво- та триобласним layout для web / panel, text counters і configurable limits; перевірити межі 5000 / 5001 та web limit, Unicode code points і paste без truncation.
- [x] 5.2 Реалізувати selection snapshots, UTF-16 span conversion та bounded context indicator; перевірити втрату фокусу на кнопці, surrogate pairs і результат тільки для виділення.
- [x] 5.3 Реалізувати explicit run, opt-in live mode з debounce і revision invalidation; перевірити fake-timer tests для typing bursts, unchanged input, mode / language changes і pause.
- [x] 5.4 Додати session-only originals, restore / clear і main-result copy з ручним fallback; перевірити відсутність draft persistence, no-copy action у back translation і нову revision після restore.
- [x] 5.5 Створити Chrome MV3 panel adapter, action / command activation і packaged AOT assets; перевірити відкриття кнопкою / hotkey та production bundle без remote executable code.
- [x] 5.6 Додати panel lifecycle cleanup і socket ownership у panel document; перевірити закриття панелі, service worker restart і відсутність запитів після pause / close.
- [x] 5.7 Додати labels, keyboard navigation, visible focus, live status announcements і некольорові diff markers; перевірити keyboard-only сценарій та automated accessibility checks.

## 6. Correction Vertical Slice

- [x] 6.1 Реалізувати correction operation із default grammar / natural wording policy, selection scope, style / level і protected spans; перевірити unchanged-text case та meaning-preservation fixtures.
- [x] 6.2 Реалізувати groups of edits, локальне прийняття / відхилення й recommendation revisions без зміни input; перевірити independent edits, overlapping groups і відновлення оригінального фрагмента.
- [x] 6.3 Додати автоматичний recommendation-to-native stage та третю область; перевірити partial failure, retry тільки цього етапу, no-copy button і відсутність feedback loop.
- [x] 6.4 Додати explicit paraphrase та до трьох alternatives із послідовним показом одного набору за дією користувача; перевірити відсутність повторної генерації при переборі, що back translation запускається лише для обраного варіанта й late response не підміняє його.
- [x] 6.5 Додати explanation на запит основною мовою, прив'язану до оригіналу й активної recommendation; перевірити відсутність автоматичного call та інвалідацію після зміни правок.
- [x] 6.6 Завершити Chrome panel + web end-to-end correction flow з account, quotas і provider double; перевірити paste → correction → back translation → copy, reconnect і session cleanup без доступу до сторонньої сторінки.

## 7. Browser Parity and Translation

- [x] 7.1 Додати Edge adapter / package та browser smoke procedure; перевірити panel open, auth callback, copy, hotkey configuration і correction lifecycle у реальному Edge.
- [x] 7.2 Додати Firefox manifest / sidebarAction adapter; перевірити ті самі сценарії, session token storage і відсутність залежності від Chromium-only APIs у shared UI.
- [x] 7.3 Реалізувати translation operation з native-anchored direction validation і комунікативною fidelity policy; перевірити всі 12 напрямків між різними мовами каталогу за відповідної основної мови й заборону двох нерідних мов.
- [x] 7.4 Додати translator UI у panel / web, direction swap без profile mutation та no-back-translation layout; перевірити selection translation, stale results і відсутність прихованого другого AI call.
- [x] 7.5 Провести інтеграційний correction / translation matrix test на трьох browser packages і web; перевірити мовні ролі, стилі, ліміти й partial failure та зберегти результати тестів.

## 8. Reference Dataset Pipeline

- [x] 8.1 Підготувати source manifest для конкретних Wiktionary / Kaikki datasets із ліцензіями, attribution, revision та правилами quotation / media exclusions; перевірити license admission fixtures, де невідомі права блокують activation.
- [x] 8.2 Додати lexical migrations для entries, senses, translations, examples, inflections, provenance і dataset releases; перевірити омоніми, кілька частин мови та однакові леми різних мов без помилкового merge.
- [x] 8.3 Реалізувати streaming sample import для чотирьох мов і coverage report за частинами мови / sections / translation languages; перевірити fixtures регулярних, нерегулярних і separable verbs та службових слів.
- [x] 8.4 Реалізувати staging validation, idempotent import і atomic release activation; перевірити crash / повторний запуск без дублів і доступність попереднього dataset до activation.
- [x] 8.5 Додати version update, removals / takedowns, monthly check і manual import command; перевірити, що rollback не повертає відкликані матеріали й не змішує releases.
- [x] 8.6 Виконати перший дозволений full import у локальне або авторизоване staging environment; перевірити counts, provenance completeness, lookup latency й coverage report, без імпорту dict.cc / DWDS / інших непогоджених джерел.

## 9. Progressive Lexical Reference

- [x] 9.1 Реалізувати explicit lookup API за language / lemma / form та candidates disambiguation; перевірити омонімію, інфлексії, unknown entry, accents і language-specific normalization.
- [x] 9.2 Додати компактну sense-based картку з перекладами, тлумаченнями, прикладами й attribution; перевірити missing native translation і відсутність помилкового зв'язування прикладів за самою лемою.
- [x] 9.3 Реалізувати language / part-of-speech section registry та API доступності; перевірити німецькі verb sections, noun / adjective / pronoun / article forms і застосовні секції службових частин мови в каталозі.
- [x] 9.4 Додати незалежні accordion sections з lazy loading і кешем незмінної source version; перевірити `missing` проти `not-applicable` / `error`, повторне розгортання й keyboard navigation.
- [x] 9.5 Реалізувати explicit AI supplement operation й machine translation of sourced content; перевірити quota accounting, labels, refusal і відсутність запису генерації в canonical reference tables.
- [x] 9.6 Додати `AiSupplement` cache із source / policy version, TTL та інвалідацією; перевірити заміщення доповнення джерельними даними й те, що private context та unknown-entry queries не потрапляють у shared cache.
- [x] 9.7 Додати error-report action для reference / supplement IDs без особистого тексту; перевірити дозволені поля звіту, rate limiting і відображення unverified grammar tables.
- [x] 9.8 Інтегрувати lookup у власний editor selection та окрему web view; перевірити, що correction / translation не запускає word harvesting і не створює personal vocabulary records.

## 10. Privacy and Operational Hardening

- [x] 10.1 Додати first-send disclosure, processing status та privacy page із фактичними backend / provider retention settings; перевірити відсутність передачі до підтвердження й узгодженість показаних строків із конфігурацією.
- [x] 10.2 Реалізувати account export з усіма збереженими user-scoped даними без інших акаунтів; перевірити authenticated download і відсутність неіснуючої постійної історії текстів.
- [x] 10.3 Реалізувати confirmed account deletion, session revocation, payload cleanup і deletion tombstones; перевірити in-flight completion race та неможливість появи нових доступних результатів після видалення.
- [x] 10.4 Додати retention cleanup для operation metadata, HMAC digests, logs і supplements; перевірити time-travel tests та відсутність raw text у database backup.
- [x] 10.5 Додати log redaction, metrics latency / failures / cost, global AI kill switch та restricted admin audit; перевірити synthetic secrets / text canaries у reverse proxy, API й error reporting.
- [x] 10.6 Провести інтеграційні security tests для IDOR, CSRF, socket auth expiry, prompt injection, XSS, payload abuse і quota races; перевірити відсутність unresolved critical findings.
- [x] 10.7 Підготувати локально відтворювані deployment manifests і rollback / backup-restore runbook без provision платних ресурсів; перевірити restore із повторним застосуванням deletion tombstones та model / dataset rollback.

## 11. Release Evidence

- [x] 11.1 Виконати language evaluation обраних model policies на `uk/de/en/vi` із дозволеним API budget та автоматичним мовним оцінюванням, ручним розбором лише спірних випадків; зафіксувати результати, явне початкове прийняття власника із відкладеними зауваженнями та activation record, без заяви про повне проходження машинних перевірок.
- [x] 11.2 Провести manifest / packaged-code / network audit Chrome, Edge і Firefox; перевірити мінімальні permissions, локальні assets, CSP, відсутність сторонніх page reads і записати точні протестовані browser versions.
- [x] 11.3 Підготувати store descriptions, single-purpose statement, screenshots, permission justifications і data disclosures; перевірити їхню відповідність реально доступним функціям, privacy page та поточним правилам кожного магазину без публікації.
- [x] 11.4 Підготувати privacy / licensing review package: data map, правові підстави, DPA / subprocessors, international transfers, retention, rights procedures, license attribution; перевірити review sign-off або явно зафіксований release blocker без заяви автоматичної юридичної відповідності.
- [x] 11.5 Провести фінальний acceptance run усіх scenarios з 11 capabilities, включаючи accessibility, reconnect і очищення; перевірити traceability requirement → test / evidence та сформувати release checklist із невиконаними gates, якщо вони залишилися.

## Implementation note (2026-10-09)

Задачі 10.1–10.7 реалізовані й локально перевірені; evidence — `docs/privacy-operations-verification.md`, runbook — `docs/deployment-recovery-runbook.md`. Для 11.1 виконано погоджений OpenAI run із cap $2 і reviewers із `deployment/reviewers.local.json`: 72 commands, 80 фактичних calls із максимуму 96, 63 contract passes, 17 failures, actual cost 32 204 micro-USD, без retries. Evidence — `docs/evaluations/openai-run-v1.json`; підсумок — `docs/evaluations/openai-run-v1-verification.md`. Sign-off export відхилено; human review pending, readiness uk/de/en/vi unreviewed, policy не активовано. Задача 11.1 лишається відкритою через contract failures і незавершений review. Release gates 11.2–11.5 лишаються відкритими.

## Рішення користувача (2026-10-13)

Поточний мовний результат прийнято для старту. Невирішені зауваження перенесено в `docs/evaluations/initial-acceptance-and-follow-ups.md`; старий pending human review не означає вимогу перевіряти вручну кожну відповідь за новим підходом. Реалізовано автоматичне оцінювання, добровільний feedback та перебір щонайбільше трьох альтернатив без повторної генерації набору. Оригінал повертається без змін за відсутності правок. Машинні звіти збережено без змін, production policy не активовано; повне release acceptance та задачі 11.1–11.5 не позначено завершеними цим рішенням.

Наступне доручення враховано в активації: `initial-acceptance-v1` дозволяє runtime policy із явним рішенням власника, hashes evidence і backlog, без підробки успішного gate. Offline exporter — `tools/accept-initial-policy.mjs`; policy — `deployment/policies.openai.accepted.json`; інструкція — `docs/evaluations/production-policy-activation.md`. Runtime validation не змінено. Експорт конфігурації не вмикає сервер і не погоджує щоденний runtime budget; release-задачі залишаються відкритими.

## Release preparation завершено (2026-10-13)

Задачі 11.1–11.5 виконано відповідно до погодженого початкового прийняття. Evidence: `docs/release/acceptance-run.json` (24 checks passed із збереженими попередніми failed attempts), `docs/release/package-audit.json`, `docs/release/package-network.json`, `docs/release/traceability.md` (11 capabilities / 48 requirements / 60 scenarios), `docs/release/store-listings.md` і `docs/release/privacy-licensing-review.md`. Native matrix охопила 120 cases на п'яти поверхнях Chrome/Edge panel+web та Firefox sidebar; Firefox додатково перевірив first-send consent і metadata-only feedback без нового provider attempt. Виправлено контраст focused text buttons у двох клієнтах, включено dependency notices у packages та оновлено застарілі fixture expectations/disclosures. Платних AI-викликів у фінальному acceptance не було.

Виконання 70/70 implementation tasks не означає публічний release: `docs/release/release-checklist.md` зберігає незавершені operator/legal/vendor/retention, production origin/auth/budget та store submission умови. Publication, production server і платну обробку не ввімкнено; legal sign-off не вигадано.
