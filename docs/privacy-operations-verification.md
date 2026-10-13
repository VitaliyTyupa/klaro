# Перевірки privacy й експлуатації

Локально, 2026-10-09. PostgreSQL 17.11, Redis 7.4, Node 22.23.2, npm 12.0.2; браузерні перевірки — Chrome 154.0.8037.57. AI-виклики використовують безкоштовний synthetic provider double або injected fetch. Реальні мовні оцінки й production provider retention не підтверджено.

| Поведінка | Перевірка |
| --- | --- |
| Явна згода до першої передачі; зміна disclosure потребує нової згоди | `tests/processing-consent.test.mjs`, `npm run test:reference-ui`, `npm run test:editor-ui` |
| Окрема privacy page й disclosure з одного backend config; unknown provider retention показується явно | `apps/api/src/privacy/config.ts`, `tests/processing-consent.test.mjs` |
| Authenticated attachment export, усі user-scoped таблиці, відсутність чужих даних й вигаданої історії | `npm run test:privacy` |
| Повторне DELETE-підтвердження, CSRF, session revocation, TTL payload cleanup, late-provider race | `npm run test:privacy` |
| 24-hour HMAC expiry, 30-day metadata/audit cleanup, 7-day public supplements | `npm run test:privacy` з time travel в окремій тимчасовій базі |
| No raw private text у дампі персональних таблиць | `npm run test:privacy`, `npm run test:operations` |
| Allowlisted logs без body/query/token/error messages; proxy/API/error canaries | `npm run test:privacy`, `tests/openai-adapter.test.mjs`, `tests/deployment.integration.mjs` |
| Admin-only metrics latency/failures/token/cost, persistent AI kill switch, source access during stop | `npm run test:privacy` |
| REST/socket IDOR, strict bodies, revoked/expired sessions, reconnect/idempotency | `npm run test:operations` |
| Atomic quota races, concurrency/rate limits, actual/estimated usage | `npm run test:budgets` |
| XSS у sourced/generated reference text, відсутність сторонніх image/script requests | `npm run test:reference-ui` |
| Prompt injection залишається data; schema validation, no tools або remote code | `tests/result-validation.test.mjs`, `tests/openai-adapter.test.mjs` |
| Authenticated encrypted backup, current deletion journal, session revocation, model/dataset rollback | `npm run test:privacy`, `tests/backup.test.mjs` |

Критичних невиправлених проблем у перелічених технічних сценаріях не виявлено. Це не оцінка здатності реальної моделі протистояти кожній інструкції в тексті, юридичний sign-off чи дозвіл публічного випуску. Доступ до CLI управління джерелом/моделлю вимагає OS-доступу до серверних DB credentials і operator identity; HTTP admin має окремий 32-byte bearer token. Аудит містить actor, визначену action і час, без довільного body; CLI-аудит фіксує спробу дії.

Дані редактора не зберігаються у localStorage, sessionStorage чи IndexedDB. Експорт включає поточні тимчасові payload лише доки вони доступні, і не включає session/CSRF secret hashes. Відсутні чи прострочені тексти не відновлюються. Видалення отримує user-row exclusive lock; прийняття payload, публікація snapshot/result і socket delivery використовують той самий бар’єр. Redis TTL не продовжується при оновленні.

API виконує retention/retry cleanup при запуску та щохвилини. Tombstone IDs й окремий зашифрований deletion journal зберігаються 35 днів для відновлення з backup віком до 30 днів; in-process compaction серіалізована з append. Відновлення виконується лише офлайн, із поточним журналом, очищенням Redis і вимкненим AI.

Docker deployment зібрано й запущено в окремому project `klaro-deployment-fixture`: frontend, CSP, proxy/API health, disabled-provider disclosure і log canaries пройшли `node tests/deployment.integration.mjs`. Середовище не provision-ить платних ресурсів. Production TLS, операторські ключі, backup schedule та provider account controls ще потребують налаштування перед випуском.

Build проходить із попередженнями про initial bundle понад 750 kB; hard limit 1 MB збережено. Фінальний release audit всіх трьох браузерів належить задачам 11.2–11.5.
