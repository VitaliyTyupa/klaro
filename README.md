# Klaro

Спільна платформа для корекції, перекладу та словникової довідки. Наразі реалізовано початковий workspace; мовні операції, автентифікація та словниковий імпорт ще не доступні.

## Локальний запуск

Потрібні Node.js **22.23.2** та npm **12.0.2**. Версії зафіксовані в `.nvmrc`, `.node-version` і `package.json`; `engine-strict` відхиляє несумісне середовище.

```bash
nvm install
nvm use
npm install --global npm@12.0.2
npm ci --ignore-scripts
npm run ci
```

Для цього набору залежностей встановлення без lifecycle scripts перевірено: platform binaries надходять як optional dependencies. Lockfile потрібно зберігати в Git. npm cache для локальної роботи розміщується в `/tmp/klaro-npm-cache`.

```bash
npm run dev:web
npm run dev:extension
```

Вебзастосунок відкривається на `http://localhost:4200`, початкова оболонка панелі — на `http://localhost:4201`. Поточна оболонка ще не є готовим пакетом розширення.

```bash
npm run build
npm run start:api
```

NestJS API слухає `127.0.0.1:3000`; `GET /health` повертає `{"status":"ok"}`. Змінна `PORT` задає інший порт. У другому терміналі batch entry point можна запустити командою `npm run start:import`; поки джерело не налаштоване, він лише показує повідомлення й завершується без завантаження даних.

## Локальні сховища

Потрібні Docker Engine та Docker Compose. Приклад конфігурації містить лише відкриті значення для локальної розробки; його не можна використовувати для публічного deployment.

```bash
cp .env.example .env
npm run infra:up
npm run db:migrate
npm run test:identity
```

PostgreSQL доступний лише на `127.0.0.1:5433`, Redis — на `127.0.0.1:6380`. Якщо змінюєте порт або пароль PostgreSQL, узгодьте також `DATABASE_URL`. Дані PostgreSQL зберігаються в named volume. Redis не має persistent volume; `/data` є tmpfs, RDB snapshots і AOF вимкнено. Приватні payload не повинні потрапляти до PostgreSQL або backup.

Migrations застосовуються транзакційно під advisory lock; checksum захищає вже застосовані файли від редагування. Нові зміни схеми додаємо наступними SQL файлами. Повторний запуск не застосовує migration двічі. `npm run infra:stop` зупиняє сервіси зі збереженням PostgreSQL; перезапуск Redis втрачає всі тимчасові ключі.

## Структура

| Шлях | Призначення |
| --- | --- |
| `apps/web` | Angular Material вебклієнт |
| `apps/extension` | Angular Material оболонка панелі |
| `apps/api` | NestJS сервер |
| `apps/reference-import` | Окремий процес імпорту довідника |
| `packages/contracts` | Спільні версійовані контракти |
| `packages/editor` | Спільні Angular компоненти |
| `packages/language-profiles` | Мовний каталог та локалізовані ресурси |
| `packages/testing` | Місце для синтетичних fixtures та provider doubles |
| `tools` | Перевірки меж клієнта й сервера |

Production AOT assets розміщуються в `dist/web/browser` і `dist/extension/browser`; серверні entry points — `dist/api/main.js` і `dist/reference-import/main.js`. Шрифти й зовнішні scripts не завантажуються.

## Перевірки та внески

```bash
npm run lint
npm test
npm run typecheck
npm run build
npm run ci
```

`ci` виконує всі чотири перевірки; GitHub workflow запускає їх після чистого встановлення. Перевірка імпортів забороняє клієнтським застосункам і shared client packages звертатися до API, importer, Node.js modules та server SDK, включно з re-exports, type imports і dynamic imports. Нову клієнтську залежність потрібно явно додати до allowlist у `tools/check-boundaries.mjs` після перегляду її призначення.

Мова обговорень і описових документів — українська. Правила коду та локалізації: [CONTRIBUTING.md](CONTRIBUTING.md). Прогрес реалізації: [OpenSpec tasks](openspec/changes/build-klaro-platform/tasks.md).

## Автентифікація

Для входу задайте `OIDC_ISSUER`, `OIDC_CLIENT_ID` і, якщо provider цього вимагає, `OIDC_CLIENT_SECRET` у `.env`. Зареєструйте єдиний callback `${APP_ORIGIN}/auth/callback` у provider. `APP_ORIGIN` — точний origin вебклієнта без завершального `/`; production вимагає HTTPS. Development proxy передає `/auth` і `/v1` до локального API.

`GET /auth/login` починає code flow з PKCE, state, nonce та browser-bound HttpOnly cookie. `GET /auth/callback` перевіряє ID token і створює application session; provider access / refresh tokens не видаються клієнту й не зберігаються. Налаштування HTTP provider дозволено лише для loopback у non-production через `OIDC_ALLOW_LOOPBACK_HTTP=true`; це потрібно локальному test provider. Без конфігурації OIDC endpoint входу повертає `unavailable`.

`GET /auth/session` повертає authenticated user ID. `POST /auth/logout` потребує точний `Origin` і `X-CSRF-Token` із cookie `klaro_csrf` (на HTTPS — `__Host-klaro_csrf`). HTTPS session cookie має `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` і префікс `__Host-`; web session діє до 8 годин та перевіряється за серверним expiry / revocation. На локальному HTTP Secure вимкнено лише для розробки. PostgreSQL зберігає hashes session / CSRF tokens.

```bash
npm run test:identity
npm run test:oidc
npm run test:sessions
```

Ці integration tests потребують локального PostgreSQL і дозволу відкривати loopback ports; OIDC provider у тестах синтетичний і не звертається до зовнішнього акаунта. Web UI для входу та extension handoff ще не реалізовано.

Extension handoff використовує `/auth/extension/login`, `/auth/extension/callback`, `/auth/extension/exchange` і `/auth/extension/logout`. Додайте точні HTTPS redirect URLs із `identity.getRedirectURL('klaro')` до `EXTENSION_CALLBACKS` (через кому). Для provider зареєструйте також `${APP_ORIGIN}/auth/extension/callback`. Одноразовий code діє 60 секунд і прив'язаний до PKCE challenge; після exchange клієнт отримує лише application token до 15 хвилин. Токен живе в memory відкритого документа, очищається на logout, expiry і `pagehide`; local / sync storage не використовуються. `npm run test:handoff` та unit tests перевіряють proof, replay, expiry і lifecycle races. Реальний packaged-browser smoke test залишається в наступних задачах.

## Профіль і налаштування

Вебклієнт має маршрути `/`, `/profile` та `/settings`. Налаштування зберігаються через authenticated `GET/PUT /v1/me/preferences`; швидкий selector у редакторі й панелі змінює тільки активну мову письма. Основна мова виключена з writing languages; якщо вона змінюється на попередню активну мову, потрібно явно обрати нову допустиму мову письма. Зміни preferences інвалідують result revision зі збереженням input. Перехід із вебредактора, logout або закриття документа очищають session-only draft.

`npm run test:ui` перевіряє сторінки у локальному Google Chrome; інший executable можна задати через `CHROME_EXECUTABLE_PATH`. HTTP auth і persistence перевіряються окремими integration tests; browser test використовує синтетичний API double.

Privacy й експлуатація: перед першою AI-передачею обидва клієнти потребують явного підтвердження. `/privacy` показує фактичну backend/provider конфігурацію; export і підтверджене deletion доступні у профілі. AI можна вимкнути через захищений operator endpoint, залишивши sourced reference доступним.

- `npm run test:privacy` — ізольовані export/deletion/retention, log canaries та encrypted backup/restore із deletion journal і rollback.
- [Privacy verification](docs/privacy-operations-verification.md) — сценарії й межі перевірок.
- [Deployment / recovery runbook](docs/deployment-recovery-runbook.md) — локальні manifests, keys, retention, backup та offline restore.

Початковий мовний результат прийнято із зауваженнями; фактичний provider account retention та operator/legal release review потрібно підтвердити до публічного випуску.

Підготовлено [OpenAI starter policy, бюджет і workflow оцінки](docs/evaluations/openai-starter.md). Після реального evaluation користувач прийняв початковий результат із зауваженнями; [механізм активації](docs/evaluations/production-policy-activation.md) підтримує окремий acceptance record, а готова конфігурація — `deployment/policies.openai.accepted.json`. Мовний review автоматичний, ручний розбір лише спірних випадків, feedback добровільний. Платний runtime budget підключається окремо через `AI_BUDGET_FILE` (Docker: `MODEL_BUDGET_FILE`); export policy не запускає сервер або платну обробку.

Підготовка випуску: [release checklist](docs/release/release-checklist.md), [requirement → test / evidence](docs/release/traceability.md), [пакети браузерів](docs/release/package-audit.md), [матеріали магазинів](docs/release/store-listings.md), [privacy/licensing review](docs/release/privacy-licensing-review.md). Виконання implementation tasks не є дозволом публікації; незавершені deployment/legal умови перелічено в checklist.
