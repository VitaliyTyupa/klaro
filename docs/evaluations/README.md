# Мовна регресія та human review

Механізм активації підтримує [початкове прийняття із зауваженнями](production-policy-activation.md): підготовлено `deployment/policies.openai.accepted.json`. Успішний автоматичний gate не є єдиним способом дозволити policy; явне прийняття зберігає фактичні відхилення у звітах і конфігурації.

Актуальне рішення користувача й невирішені зауваження: [початкове прийняття та подальші покращення](initial-acceptance-and-follow-ups.md). Поточний результат прийнято для старту; використовуємо автоматичне мовне оцінювання, добровільний feedback і ручний розбір спірних випадків. Наведена нижче процедура повного human review описує початковий прогін, а не вимогу повторно оцінювати кожну відповідь вручну.

Підготовлена OpenAI конфігурація, розрахунок бюджету й пояснення report/evaluation: [OpenAI starter](openai-starter.md). Runner підтримує `evaluation:plan` (без викликів), `evaluation:run` (платний прогін з окремим cap) та `evaluation:signoff` (перевірка evidence/review й export policy без activation). Перший real-model run виконано: [результати й блокери](openai-run-v1-verification.md). Людський review ще pending; policy не активовано.

`npm run test:language-regression` виконує 12 синтетичних correction fixtures для `de/en/uk/vi` через provider double й записує `double-regression.json`. Набір не містить приватних текстів. Double залишає текст незмінним; harness перевіряє contract, мовну metadata, numbers та protected terms. Його успіх не є оцінкою граматики, стилю, перекладу чи готовності мов.

Для реальної policy звіт має містити точні model / prompt / fixture versions, дату, погоджений API budget, actual / estimated usage, усі candidates, reviewer і notes. Перед запуском потрібні дозволений бюджет та визначені reviewers. Перший реальний evaluation належить завданню 11.1; його evidence збережено в `openai-run-v1.json`, але задача ще відкрита через contract failures і незавершений human review.

Для кожного case reviewer заповнює `humanReview` значеннями `pass` або `fail` замість `pending`:

- `grammar`: виправлення правильні й природні; не створено нових граматичних помилок.
- `meaning`, `facts`: не додано/вилучено фактів, імен, адресатів, часових умов; неоднозначний намір не замінено вигадкою.
- `numbers`: кількість, дата, одиниці й точність збережені. Автоматична наявність цифр є лише індикатором; reviewer перевіряє їхні зв’язки.
- `negation`, `commitment`: заперечення й ступінь обіцянки / можливості / впевненості збережені.
- `style`: виконано neutral/formal і proficiency; у німецькій neutral — du, formal — Sie; інших мов не змушують наслідувати ці форми.
- `protected-terms`: захищені фрагменти залишилися дослівними.
- `ambiguity`: невизначеність пояснена або позначена, без довільної зміни наміру.

Зміна факту, числа, заперечення, зобов’язання чи protected term — critical failure і блокує policy activation. `pending`, відсутній reviewer або незавершені критичні cases також блокують sign-off. Критичні meaning / grammar cases потребують review людиною, яка володіє відповідною мовою. Зворотний переклад можна додати для аналізу, але він не є самостійним quality oracle. Candidate review включає automatic native rendering, translation directions, paraphrase, alternatives та explanation; correction fixtures є початковою базою для розширеного run у 11.1.

OpenAI policy evaluation record є адміністративним посиланням на завершений звіт: `reportId`, matching `modelPolicyVersion` / `promptVersion`, чотири мови, `contractPassed` і `humanReviewPassed`. Наявність цих полів сама по собі не замінює огляд evidence. Synthetic report не можна використовувати як real-model sign-off.
