# План першої реальної мовної оцінки

Статус: задача 11.1 не виконана. На 2026-10-09 виконано погоджений real-model run із cap $2 та reviewers із `deployment/reviewers.local.json`: [підсумок і блокери](openai-run-v1-verification.md), [evidence](openai-run-v1.json). 80 calls, 63 contract passes, 17 failures, actual cost $0,032204; human review ще pending. Наявність credentials і synthetic double results не є quality evidence. Для `uk/de/en/vi` readiness залишається `unreviewed`; публічний AI release заблоковано.

## Рішення до запуску

Потрібні exact model ID, immutable model/prompt/price policy versions, актуальна перевірена ціна, max input/output tokens, maximum total API budget і reviewers для чотирьох мов. Credentials налаштовуються локально на сервері; не передавати ключі в чат, fixtures, report чи клієнтський bundle. Provider deployment retention також має бути перевірено й внесено в disclosure; `store:false` не замінює цю перевірку.

## Пропонований bounded run

| Операції | Commands | Верхня кількість provider calls |
| --- | ---: | ---: |
| Existing 12 synthetic correction cases + 4 explicit grammar cases, з automatic native rendering | 16 | 32 |
| Translation: усі 12 ordered language pairs, neutral/formal | 24 | 24 |
| Paraphrase: 4 мови × 2 стилі, з native rendering | 8 | 16 |
| Alternatives: 4 мови × 2 стилі, до 3 candidates/call | 8 | 8 |
| Explanation для затверджуваних recommendations | 8 | 8 |
| Lexical generated supplement для 4 мов | 4 | 4 |
| Source translation у 4 target languages | 4 | 4 |
| Разом | 72 | 96 |

Це початковий план, а не вже виконаний run або гарантія достатньої якості. Професійні human reviewers перевіряють відповідні grammar/meaning cases; для української й в’єтнамської не переносити німецькі форми звертання. Style/proficiency matrix включає neutral/formal, A2/B2, de du/Sie, selection context, protected spans, numbers/facts/negation/commitment та ambiguity. Case із відмовою або неповним результатом записується, не повторюється автоматично.

Перед першим реальним dispatch harness має обчислити upper bound кожного stage із погодженої price policy, резервувати весь run у межах cap і зупинятися до наступного call, якщо його bound перевищує залишок. Якщо cap недостатній для повного run, не зменшувати мовний scope мовчки. Usage у звіті позначається actual/estimated; unknown usage консервативно враховується за bound. Нові оплачувані retries потребують явного включення в погоджений cap/run.

## Review evidence

Взяти структуру `docs/evaluations/double-regression.json` і критерії `docs/evaluations/README.md`, але виставити `realModelEvaluation=true` лише для реально виконаних calls. Записати точні versions, synthetic fixture ID/input/candidate, outcome, usage/cost, дату, reviewer, notes та pass/fail/pending кожного критерію. Не використовувати приватні користувацькі тексти.

Зміна факту/числа/заперечення/зобов’язання/protected term — critical failure. Неправильна grammar або meaning у критичних cases, `pending` чи відсутній reviewer блокують activation. Native/back translation — допоміжний матеріал, не quality oracle. Після human sign-off створити matching evaluation record для PolicyRegistry і зберегти посилання на сам evidence report. Flags у JSON не замінюють людський review.

## Наступні release gates

Після цієї оцінки залишаються 11.2 browser package/network audit, 11.3 store materials/current rules, 11.4 privacy/licensing review і 11.5 final acceptance/traceability. Задачі 10 завершують технічний privacy/operations шар, а не юридичний sign-off чи публікацію.
