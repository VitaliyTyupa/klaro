# Release checklist

Підготовка першої версії, 2026-10-13. Статус виконання тестів дивитися в [acceptance-run.json](acceptance-run.json), а не лише за наявністю цього документа. [Traceability](traceability.md) охоплює 11 capabilities / 48 requirements / 60 scenarios. Публічний випуск ще не дозволений через deployment і legal умови нижче.

Фінальний acceptance: **24 checks passed**, 120 native/browser matrix cases на п'яти поверхнях, paid calls **0**. Після виправлень повторено лише невдалі lifecycle/Firefox checks; попередні failures збережено у `previousAttempts`, а всі п'ять matrix evidence перевірено на свіжість у межах цього run. Окремий фінальний network audit перевірив observer self-check у трьох браузерах; screenshots visually reviewed, Axe/keyboard checks і фінальний lint пройшли.

## Підготовлене evidence

- Мовний evaluation і автоматичний judge збережені без зміни machine outcomes. Власник явно прийняв початковий результат; [accepted policy](../../deployment/policies.openai.accepted.json) допускається runtime registry. Невирішені мовні/contract findings — [backlog](../evaluations/initial-acceptance-and-follow-ups.md), не прихований pass.
- [Manifest/code/CSP audit](package-audit.json) прив'язаний до hashes packaged files; [мережевий сценарій](package-network.json) виконаний на реальних Chrome, Edge і Firefox. Package включає dependency notices.
- [Store descriptions, disclosures, permission justifications](store-listings.md) та два перевірені PNG UI snapshots підготовлені без submission.
- [Privacy/licensing review package](privacy-licensing-review.md) містить data map, retention, proposed legal bases, contracts/transfers, rights procedures та attribution; legal sign-off pending явно блокує public release.
- Локальний acceptance використовує synthetic provider та isolated test users. Перевірки включають auth, transport/IDOR/CSRF, budgets, payload TTL, crash recovery, reference imports, account export/deletion, keyboard/accessibility, native browser matrix, session cleanup та packaging. Він не запускає OpenAI або production deployment.

## Умови перед production запуском і публікацією

| Умова | Поточний стан | Що завершити |
| --- | --- | --- |
| Model policy | Початкове прийняття з відкладеними зауваженнями | Використати accepted configuration; нова модель/prompt потребує відповідного evaluation/рішення. |
| Runtime budget | Щоденний бюджет не погоджено цим apply | Зафіксувати ліміти для роботи, відмінні від попередніх разових $2 evaluation caps. |
| Production backend/TLS | Пакети використовують `klaro.example` | Обрати реальний origin, TLS, hosting/region, secrets і operational backup schedule; перепакувати й повторити аудит кінцевих пакетів. |
| OIDC та callback allowlists | Локальні fixtures; production vendor/IDs не визначені | Обрати vendor, кінцеві extension IDs, точні callback URLs/Origins; перевірити реальний login без test overrides. |
| Operator/privacy/provider controls | Legal release blocker | Controller/contact/privacy/support URLs, contracts/DPA/subprocessors/transfers, фактичний OpenAI retention notice й reviewer decision. |
| Licensing/distribution | Source admission та provenance перевірені; final review pending | Підтвердити attribution/ShareAlike, права на власний код і бренд, included dependency notices та source bundle для AMO. |
| Store submission assets | Draft descriptions/disclosures і web UI PNG підготовлені | Кінцеві logo/icons, native package screenshots, developer/reviewer access, URLs та ще одна звірка dashboard полів. |
| Publishing | Не виконано | Окреме доручення власника після закриття release blockers. |

First-send consent, добровільний feedback, до трьох послідовних альтернатив і незмінний оригінал без правок відповідають погодженому підходу. Прийняття policy не вимикає runtime validation чи global AI kill switch і не замінює legal/store рішення.

## Відтворення acceptance

```sh
node --env-file-if-exists=.env tools/run-release-acceptance.mjs
```

Потрібні local PostgreSQL/Redis, installed Chrome/Edge, Firefox/geckodriver і Xvfb. Paths Firefox можна задати через environment. Runner не друкує env/secrets у report, записує command/status/timestamps і виконує DB fixtures послідовно. Якщо окремий check не пройшов, після виправлення можна виконати `--retry-failed`; попередні невдалі attempts зберігаються в report, успішні перевірки не запускаються повторно. Зміни production-коду після acceptance потребують відповідних повторних checks.

Build має soft warnings для initial bundle понад 750 kB; hard limit 1 MB проходить. Це відкладене покращення розміру, а не failure поточного build.
