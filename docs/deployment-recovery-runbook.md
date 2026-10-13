# Локальне розгортання, rollback і відновлення

Виконувати з кореня репозиторію. Платні ресурси й публікація не створюються. Один API instance володіє виконанням операцій. Node/npm і digest базового образу зафіксовані в `deployment/Dockerfile`; PostgreSQL/Redis використовують версії `compose.yaml`.

## Локальний стенд

```sh
docker compose -f compose.yaml -f deployment/compose.local.yaml config --quiet
docker compose -f compose.yaml -f deployment/compose.local.yaml build app
docker compose -f compose.yaml -f deployment/compose.local.yaml up -d --wait
```

Frontend і proxy: `http://localhost:8080`. API всередині контейнера слухає лише loopback. Redis не має AOF/RDB й використовує tmpfs. Без OIDC/provider configuration вхід/AI недоступні; бібліотека не вигадує автентифікацію чи мовну готовність. `AI_ENABLED=false` за замовчуванням. Для synthetic development можна явно задати `AI_PROVIDER=double`; production його забороняє.

Оператори постачають secrets через захищене середовище; не комітити `.env`, ключі чи сертифікати. Для акаунтів обов’язково налаштувати `DELETION_JOURNAL_KEY` — 32 random bytes у hex. Окремий journal volume не відкочувати разом із PostgreSQL. `ADMIN_TOKEN` має окремі 32 random bytes, `ADMIN_ACTOR` — стабільну operator identity. У production API відмовляє в запуску без journal path/key; proxy відмовляє без `TLS_CERT_FILE`/`TLS_KEY_FILE`. Production override має задати `NODE_ENV=production`, HTTPS `APP_ORIGIN`, read-only certificate mounts та exact extension origins/callbacks. Перед відкриттям доступу потрібні всі release gates задач 11; локальний manifest сам їх не засвідчує. `MODEL_POLICY_FILE` на host монтується read-only у `/run/klaro/policies.json`; за замовчуванням використовується безкоштовна disabled-development policy. Для OpenAI необхідний власний reviewed policy file; секрет не входить до нього.

## Зупинка AI та rollback

`POST /v1/admin/ai` з окремим operator bearer credential і `{ "enabled": false }` зупиняє нові прийняття/dispatch; наявний dispatch може завершитися. Стан persistent, не скидається рестартом. `GET /v1/admin/metrics` доступний тому самому оператору й аудитований. Не вставляти credentials у URL чи публічні shell transcripts.

Для model rollback зупинити API, залишити AI вимкненим, забезпечити серверний `AI_POLICY_FILE`, `DATABASE_URL`, `ADMIN_ACTOR`, `RESTORE_OFFLINE=true`, потім:

```sh
node --env-file=.env tools/activate-policy.mjs previous-reviewed-policy-version
```

Pointer змінюється лише на вже наявну policy, перевірену registry; real-provider policy потребує matching evaluation record. Operator перевіряє сам report/human sign-off, а не лише flags у JSON. Перезапуск застосовує policy до нових операцій. Не продовжувати старі provider calls після рестарту.

Для dataset rollback:

```sh
npm run start:import -- rollback --release=VALIDATED_RELEASE_UUID
```

Лише complete validated admitted release допускається; поточні takedowns/revocations продовжують діяти. Після database restore повторно звірити **актуальні**, поза backup збережені права джерела й takedown decisions; старий manifest не є новим legal sign-off. Ніколи не активувати revoked dataset. Для application rollback повернути попередній digest образу; SQL migrations не редагувати й не відкочувати руйнівно. Старий образ використовувати лише якщо він сумісний з поточною схемою; інакше виконувати offline restore.

## Зашифрована резервна копія

На host встановити `BACKUP_KEY` як окремий 32-byte hex key, `DATABASE_URL` для цільової бази. Tool працює через локальний Docker Compose postgres service й streaming AES-256-GCM; plaintext dump не пишеться при створенні.

```sh
node --env-file=.env tools/backup.mjs create /protected-backups/klaro-YYYY-MM-DD.enc
```

Файл 0600; існуючий backup не перезаписується. Окремо зберігати journal volume та його encryption key. Налаштувати щоденний backup і expiry/delete backup files не пізніше 30 днів, із перевіркою останнього успішного запуску. Scheduler/зовнішнє backup storage не provision-яться цим change. Snapshot не містить Redis або приватних текстів редактора; canonical public dictionary text у ньому допустимий.

## Offline restore

1. Зупинити доступ клієнтів/API. Поточний deletion journal зберегти незалежно від бази, не брати стару копію журналу з того самого backup.
2. Перевірити вік backup ≤30 днів, `BACKUP_KEY`, `DELETION_JOURNAL_FILE`, `DELETION_JOURNAL_KEY`, `DATABASE_URL`, `REDIS_URL`. Задати `RESTORE_OFFLINE=true` й `AI_ENABLED=false`.
3. Restore tool перед зміною бази автентифікує AES-GCM та тимчасово розшифровує архів у 0600 file; будь-яка помилка залишає application offline. Tool видаляє temporary file після завершення.

```sh
node --env-file=.env tools/backup.mjs restore /protected-backups/klaro-YYYY-MM-DD.enc
```

4. Tool застосовує актуальні deletion IDs, видаляє відновлені акаунти, відкликає **всі** restored sessions, прибирає HMAC digests й усі `klaro:payload:*` Redis keys, залишає AI disabled. Незавершені metadata operations обробляє startup recovery без повторного dispatch.
5. Перевірити deleted-user absence, session revocation, canonical source rights/takedowns, active dataset/model versions, retention cleanup і health. Вхід вимагатиме нової сесії; приватні результати не відновлюються. Дозволити AI лише після перевірки policy/evaluation/retention.

Офлайн можна виконати `tools/deletion-journal.mjs compact`; під час роботи API compaction виконується щохвилини з тим самим in-process lock, що й append. Journal зберігає мінімальні deletion IDs до 35 днів. Не запускати зовнішню compaction паралельно з API.

## Перевірка відновлення

`npm run test:privacy` створює окремі fixture databases і використовує зарезервований Redis database 15. Він перевіряє encrypted custom-format pg_dump/pg_restore, deleted IDs, sessions/HMAC cleanup, model pointer rollback, dataset rollback, stale supplements й time-travel retention. `tests/backup.test.mjs` перевіряє tampering; `tests/deployment.integration.mjs` — запущений isolated Docker deployment. Ці перевірки не відновлюють і не видаляють основну словникову базу.
