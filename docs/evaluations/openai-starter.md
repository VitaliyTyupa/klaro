# OpenAI: кандидат policy, бюджет і оцінка

Оновлення 2026-10-13: поточний результат прийнято користувачем із зауваженнями. Доступна policy `deployment/policies.openai.accepted.json` із окремим acceptance record; [інструкція активації](production-policy-activation.md). Нижче збережено початковий workflow повного sign-off; його невдалий export не блокує новий шлях явного прийняття.

Підготовлено 2026-10-09. Перший погоджений real-model run виконано: [результати](openai-run-v1-verification.md), [evidence](openai-run-v1.json). Human sign-off ще немає; contract failures блокують export. Policy є кандидатом, а не дозволом на production activation. Задача 11.1 залишається незавершеною.

## Модель та конфігурації

`deployment/policies.openai.candidate.json` вибирає exact snapshot `gpt-4.1-mini-2025-04-14`, prompt `language-v5`, до 16 384 input tokens і 4 096 output tokens на stage. Це консервативні ліміти застосунку для першого короткого evaluation; довгі тексти можуть не поміститися, а неповна відповідь не вважається успіхом. Зміна лімітів або prompt потребує нової версії та відповідного review.

Модель підтримує Responses API, Structured Outputs і не має окремого reasoning step. За [офіційною документацією OpenAI](https://developers.openai.com/api/docs/models/gpt-4.1-mini) Standard text input коштує $0,40, output — $1,60 за мільйон токенів. У policy це `400000` і `1600000` micro-USD за мільйон токенів. Cached-input discount не закладено в bound. Це економний кандидат для корекції, перекладу й пояснень; якість для uk/de/en/vi має підтвердити evaluation, а не вибір назви моделі.

`deployment/budgets.openai.starter.json` — окрема runtime budget policy: максимум $2 на UTC-добу для всього застосунку, максимум $2 на користувача, 2 млн токенів, один одночасний запит, до 10 запитів за хвилину на користувача. Загальний ліміт спільний для всіх користувачів, а не $2 кожному. Він поновлюється наступної доби і НЕ є лімітом $2 за весь строк роботи або за evaluation run.

`deployment/budgets.disabled.json` зберігає попередній нульовий paid budget. Сервер читає runtime budget через `AI_BUDGET_FILE`; Docker монтує host `MODEL_BUDGET_FILE` як `/run/klaro/budgets.json`. Незадане значення зберігає нульовий бюджет. Ці конфігурації не підключено до локального `.env` автоматично; paid processing не ввімкнено.

## Чи вистачить $2

Для [плану з 72 commands / 96 provider calls](real-model-run-plan.md), якщо кожен call вкладається в обидва ліміти кандидата:

```
cost/call = (16384 × 0.40 + 4096 × 1.60) / 1000000
          = $0.0131072
96 calls  = $1.2582912
```

Сервер округлює до цілих micro-USD на call: `13108 × 96 = 1258368`, тобто близько $1,26. $2 достатньо для одного такого token run із запасом. Для прикладу, 2 000 input + 1 000 output tokens на call дали б $0,2304 за 96 calls; це ілюстрація, а не виміряний прогноз. Оплата роботи reviewers, податки й інші запити до OpenAI сюди не входять. Баланс/доступ до моделі потрібно перевірити у своєму API account; вибраний snapshot не гарантує доступ конкретному проєкту.

`EVALUATION_MAX_COST_MICROUSD=2000000` означатиме окремий cap $2 на evaluation run після явного погодження запуску. `evaluation:run` тепер читає цю змінну, вимагає позитивне ціле число й перевіряє повний upper bound до першого dispatch. Runtime daily budget не підміняє evaluation run cap. Ключ сам по собі також не задає бюджет.

## Як утворюється evidence

Зараз `npm run test:language-regression` запускає 12 correction cases через deterministic double й автоматично записує `docs/evaluations/double-regression.json`. Він не викликає OpenAI і не доводить мовну якість. OpenAI adapter уже є в `apps/api/src/ai/openai-responses.ts`, а reusable contract validation — у `result-validation.ts`.

Реалізовано `tools/run-real-language-evaluation.mjs`: він використовує цей самий adapter і validation, бере кандидат policy через окремий offline parser, не обходячи runtime activation gate. До першого dispatch він перевіряє весь run bound і погоджений cap; записує всі outcomes, припиняє нові calls при недостатньому бюджеті й не робить прихованих retries. Перед кожним dispatch записує checkpoint із conservative charge; перерваний report не перезапускається, наявний файл не перезаписується. До набору додано чотири явні grammar-error cases з контекстом — по одному на мову. OpenAI Evals API або Playground не є необхідними залежностями цього локального workflow.

Runner автоматично формує JSON evidence: report ID, дату, exact model/model-policy/prompt/price/fixture/workflow versions, case input, усі outputs, contract checks, usage input/output tokens, actual/estimated cost, відмови/неповні результати/помилки. На початку `humanReview` має `pending`, а readiness — `unreviewed`. Відсутні usage консервативно рахуються за bound, а не за нуль. Fixtures синтетичні; приватні тексти й credentials у звіт не потрапляють.

Людина читає source та кожен candidate і заповнює pass/fail, reviewer ID, дату та конкретні notes за [критеріями](README.md). `reviewers.example.json` показує mapping чотирьох мов: `null` потрібно замінити реальними reviewer identifiers у локальній копії. Призначений reviewer не означає завершений review. Для grammar/meaning потрібна людина, яка володіє відповідною мовою; один reviewer може охоплювати кілька мов за відповідної компетентності. Для перекладу потрібно розуміти source і target. AI або зворотний переклад можуть допомагати, але не замінюють human sign-off.

Приклад критичного case: «Я НЕ обіцяв підписати ABC-123». Output «Я підпишу ABC-123» може мати правильну граматику й JSON, але провалює negation, meaning і commitment; такий результат блокує activation.

Успішний завершений run: усі заплановані cases/stages виконані й мають валідний contract; потрібні мови, directions та operations покриті; немає критичних grammar/meaning/facts/numbers/negation/commitment/protected-term failures; усі required human reviews завершені з pass і reviewer/notes; витрати вкладаються в погоджений cap. Після змін моделі чи prompt потрібні нові outputs і повторний review, не редагування невдалого output у старому звіті.

## Що додається вручну

Evidence outputs/usage/checks має створювати runner. Вручну додаються людські judgments і sign-off. `evaluation:signoff` перевіряє повне coverage, незмінність machine evidence через digest, matching policy/fixture versions, бюджети, результати через domain validation та всі human judgments; після цього автоматично додає короткий `evaluation` record до копії кандидата. Неповні/failed reviews блокують export. Digest виявляє зміну outputs після run, але не є підписом і не доводить чесність reviewer; evidence/review лишаються адміністративною відповідальністю. Очікувана форма record **лише після успішної перевірки**:

```json
{
  "reportId": "openai-language-review-2026-10-09-v1",
  "modelPolicyVersion": "openai-gpt41mini-model-v1",
  "promptVersion": "language-v5",
  "languages": ["uk", "de", "en", "vi"],
  "contractPassed": true,
  "humanReviewPassed": true
}
```

Це приклад структури, не вже виконаний report. `PolicyRegistry` перевіряє форму record і matching versions; він не читає файл evidence за `reportId` і не перевіряє справжність reviewer judgment. Отже, встановлення `true` вручну без evidence не створює успішного evaluation. У candidate JSON record навмисно відсутній; runtime його відхилить, навіть із `AI_ENABLED=false`.

## Підключення після завершеної оцінки

Зберегти копію кандидата із підтвердженим `evaluation` як `deployment/policies.openai.reviewed.json`. Для прямого запуску сервера використовувати:

```dotenv
AI_PROVIDER=openai
AI_POLICY_FILE=./deployment/policies.openai.reviewed.json
AI_BUDGET_FILE=./deployment/budgets.openai.starter.json
OPENAI_API_KEY=<локальний секрет>
```

Для Docker використовувати host paths:

```dotenv
AI_PROVIDER=openai
MODEL_POLICY_FILE=./deployment/policies.openai.reviewed.json
MODEL_BUDGET_FILE=./deployment/budgets.openai.starter.json
OPENAI_API_KEY=<локальний секрет>
```

Docker задає container `AI_POLICY_FILE` / `AI_BUDGET_FILE` сам. До ввімкнення processing потрібні звичайні auth/HMAC налаштування, актуальний provider retention disclosure та operator control. Model policy/evaluation — серверна конфігурація, яку web/extension не надсилають до OpenAI як готовий JSON. Adapter використовує її для model ID, output limit, timeout і strict schema; application використовує ціни/ліміти для резервування бюджету.


## Команди

Без мережі й витрат, навіть якщо API key уже налаштований:

```bash
npm run evaluation:plan
```

Після погодження бюджету заповнити `EVALUATION_POLICY_FILE` (default — candidate), `EVALUATION_MAX_COST_MICROUSD=2000000` і `EVALUATION_REVIEWERS_FILE` із чотирма реальними identifiers. `$1`/`$2` не є допустимим числовим форматом. Paid runner не залежить від OIDC, HMAC, Redis чи PostgreSQL: це ізольований прогін синтетичних fixtures. Runtime budget та `AI_PROVIDER=double` не підміняють його окремий cap або candidate file.

Наступна команда **робить платні OpenAI calls**, тому запускається лише для погодженого прогону:

```bash
npm run evaluation:run -- --report=docs/evaluations/openai-run-v1.json
```

Reviewers редагують тільки `cases[].stages[].humanReview[language]`: усі `criteria` з `pending` на `pass`/`fail`, `reviewedAt` як ISO timestamp і `notes` з конкретним обґрунтуванням. Reviewer ID має збігатися з assigned mapping. Source/target reviews потрібні для кожного translation stage, усі alternatives — частина review одного stage. Решту machine evidence не змінювати. Raw report readiness лишається `unreviewed`; завершений допуск містить exported policy record. Після завершеного review:

```bash
npm run evaluation:signoff -- --report=docs/evaluations/openai-run-v1.json --output=deployment/policies.openai.reviewed.json
```

Export не запускає API calls і не змінює runtime `.env`. Задача 11.1 завершується тільки після реального run і human sign-off; mock-HTTP tests цього не замінюють.
