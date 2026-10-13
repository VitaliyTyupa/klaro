# Перевірка початкового workspace

Перевірено локально 2026-10-09: Node.js 22.23.2, npm 12.0.2, Angular 21.2.25, Angular CLI / build 21.2.26, Material / CDK 21.2.14, NestJS 11.2.7, TypeScript 5.9.3.

- Чисте встановлення `npm ci --ignore-scripts` із зафіксованого lockfile та нового каталогу вихідного коду успішне. Повторна локальна перевірка використовувала `--offline --no-audit --no-fund` із попередньо завантаженим cache.
- `npm run ci` у чистому каталозі завершився успішно: lint, перевірка імпортів, unit tests, Angular strict template / TypeScript typecheck та production builds.
- 8 тестів імпортів перевіряють client-safe Angular / contracts, серверний relative import, re-export, NestJS dynamic import, Node.js require, server type import, non-literal dynamic import та importer access.
- Обидва Angular production builds використовують AOT; початковий bundle кожного становить приблизно 120 kB до стиснення. Сервер і importer компілюються до CommonJS для Node.js.

Ця перевірка стосується лише початкової оболонки. Вона не підтверджує працездатність мовних операцій, автентифікації або браузерних пакетів. GitHub-hosted workflow ще не запускався; локально перевірено ті самі команди.

Сумісність Node.js / TypeScript / Angular перевірено за [офіційною таблицею Angular](https://angular.dev/reference/versions). NestJS 11 вимагає Node.js 20 або новіший: [migration guide](https://docs.nestjs.com/migration-guide). Точні опубліковані версії залежностей перевірено через npm registry.

Локальна інфраструктура: Docker Compose підняв PostgreSQL і Redis з успішними healthchecks. `0001_application_schema.sql` застосовано на новій базі; повторний запуск не створив повторного запису. Redis `CONFIG GET` підтвердив порожній `save` і `appendonly=no`; синтетичний ключ із TTL 60 секунд був відсутній після restart (`EXISTS=0`). Redis data directory використовує tmpfs, persistent volume відсутній.

Контракти `v1`: 7 schema tests перевірили invalid enums / version, мовні ролі, 5000/5001 та 20000/20001 Unicode code points, UTF-16 boundaries, вкладені extra fields, заборонені client-supplied user / model fields, 12 native-anchored мовних пар, максимум 3 alternatives і event correlation. Усі пройшли; загалом виконано 15 unit tests (8 boundaries + 7 contracts). Schema implementation спирається на [Zod API](https://zod.dev/api).

Identity / web auth: локальні PostgreSQL та HTTP integration tests пройшли unique constraints, foreign keys, каскадне видалення й user-scoped queries; PKCE S256, signed ID tokens, issuer / audience / nonce, replay, callback tampering, browser binding та flow expiry; HTTP login/callback, HTTPS cookie flags, відмову без CSRF / із чужим Origin, logout, expired і revoked sessions. Test provider використовує synthetic identity. Перевірка production TLS termination і реального OIDC vendor ще не виконувалася. Adapter побудовано на [openid-client](https://github.com/panva/openid-client).

Preferences UI: у Chrome 154.0.8037.57 browser test перевірив save/reload мовних налаштувань, стилю й proficiency, власний profile, quick selector зі збереженням чернетки та відсутність local/session storage для draft. Два editor state tests підтвердили revision invalidation, відхилення late result та session cleanup. Вигляд сторінки налаштувань перевірено за screenshot. Поточні Material form / router bundles мають попередження початкового warning budget 750 kB, але проходять hard limit 1 MB; це не browser-store release evidence.
