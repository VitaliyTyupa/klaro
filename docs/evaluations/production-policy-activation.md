# Активація policy з початковим прийняттям

Рішення користувача від 2026-10-13 дозволяє активацію поточної model policy з відкладеними зауваженнями. Запис `initial-acceptance-v1` є окремою підставою активації поряд із повним human sign-off та успішним автоматичним gate. Він не видає відхилення за успішні перевірки.

## Підготовлені файли

- `deployment/acceptance.openai.initial.json` — рішення користувача, позначеного адміністративним ідентифікатором `project-owner`, причина прийняття та hashes двох звітів і документа зауважень. Це запис рішення з цієї сесії, а не цифровий підпис або мовний review кожного прикладу.
- `deployment/policies.openai.accepted.json` — runtime-конфігурація з новою версією `openai-gpt41mini-policy-initial-v1`, тією самою моделлю та prompt. В evaluation залишаються `contractPassed: false` і `languagePassed: false`.
- [Зауваження та початкове прийняття](initial-acceptance-and-follow-ups.md) — відкладені покращення.

Offline exporter перевіряє цілісність machine evidence, калібрування судді та відповідність прийняття конкретним звітам і документу. Команда не викликає OpenAI, не змінює звіти та не перезаписує наявний output:

```sh
npm run build:contracts
npx tsc -p apps/api/tsconfig.json
node tools/accept-initial-policy.mjs --source=docs/evaluations/openai-run-v1.json --judge=docs/evaluations/openai-judge-v1.json --acceptance=deployment/acceptance.openai.initial.json --policy-version=openai-gpt41mini-policy-initial-v1 --output=deployment/policies.openai.accepted.json
```

Зміна model/prompt потребує нової оцінки та рішення; зміна документа зауважень потребує оновленого запису прийняття перед наступним export. Runtime перевіряє структуру й matching versions адміністративної policy, а не читає локальні evaluation-файли. Доступ до конфігурації залишається відповідальністю оператора, як і для попередніх типів sign-off.

## Увімкнення на сервері

Для прямого запуску використати `AI_PROVIDER=openai`, `AI_POLICY_FILE=./deployment/policies.openai.accepted.json`, `AI_BUDGET_FILE=<погоджена runtime budget policy>`, локальний `OPENAI_API_KEY` і `AI_ENABLED=true`. Для Docker host path задається як `MODEL_POLICY_FILE=./deployment/policies.openai.accepted.json`; container path встановлює deployment manifest. Потрібні звичайні auth/HMAC налаштування, база й Redis.

`deployment/budgets.openai.starter.json` є прикладом cap $2 на UTC-добу; це щоденне поновлення, а не разовий cap. Попередні дозволи $2 на generation та judge не є погодженням щоденних production-витрат.

У цьому оновленні підготовлено конфігурацію, яку runtime допускає до активації. `.env`, робочий сервер і платні виклики не змінювалися. Увімкнення процесу й deployment — окремі дії.

Під час роботи перевірки формату відповіді, меж правок, реконструкції тексту, protected terms і бюджетів залишаються чинними. Прийняття результату не дозволяє застосувати непридатну відповідь до тексту. За відсутності правок повертається оригінал; альтернативи обмежені трьома й показуються по черзі. Feedback добровільний; ручний розбір стосується спірних випадків. Для зупинки використовувати наявний AI kill switch; для rollback — попередню дозволену policy з сумісним provider. Synthetic double у production заборонений.
