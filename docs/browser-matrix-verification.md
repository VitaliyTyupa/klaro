# Browser correction / translation matrix

Задача 7.5 виконана 2026-10-09 із локальними PostgreSQL / Redis, signed OIDC fixture та deterministic provider double. Реальні моделі та семантична якість залишаються gate задачі 11.1.

| Поверхня | Browser version | Cases | Operations | Provider attempts |
|---|---|---:|---:|---:|
| Chrome native panel | 154.0.8037.57 | 24 | 72 | 96 |
| Chrome web | 154.0.8037.57 | 24 | 72 | 96 |
| Edge native panel | 155.0.4283.45 | 24 | 72 | 96 |
| Edge web | 155.0.4283.45 | 24 | 72 | 96 |
| Firefox native sidebar | 157.0.1 | 24 | 72 | 96 |

Кожна поверхня перевірила всі 12 native / writing pairs із `neutral/A2` та `formal/B2`. У кожному case: correction → native rendering, forward translation і reverse translation. Перевірено UI launch, завантаження server preferences, точні preferences та language roles у Redis results, два attempts для correction й один для кожного translation, відсутність прихованої додаткової операції, swap без profile mutation, stale copy blocking та logout cleanup.

Unicode input з 5001 / 20001 code points залишається у полі й блокує запуск без operation. На inclusive межах 5000 / 20000 перевірено selection correction із surrogate pairs, bounded context, незмінним input та результатом тільки для selection. Матриця використовує окремі synthetic accounts без підміни production quotas; записи та payload прибираються після run. Native UI automation не входить до packages.

Окремі partial-failure runs на Chrome panel, Edge panel, Firefox sidebar та Chrome web перевірили збереження основної recommendation й explicit retry лише native rendering. Chromium runs також перевірили reconnect, native clipboard write, quota refusal та close/reopen cleanup; Firefox — native clipboard і hotkey у Xvfb. Машинні результати: [browser-matrix](evaluations/browser-matrix/). Вони містять лише test metadata без приватних payload або credentials.

```sh
KLARO_BROWSER_HEADED=1 GECKODRIVER_PATH=/snap/firefox/current/usr/lib/firefox/geckodriver FIREFOX_EXECUTABLE_PATH=/home/vitalik/Projects/klaro/dist/test-browsers/firefox/firefox xvfb-run -a npm run test:browser-matrix
```

Firefox / geckodriver paths налаштовуються для середовища. `npm run lint` і `npm run build` успішні. Build має наявні initial-bundle warnings; це не claim завершення release audit.
