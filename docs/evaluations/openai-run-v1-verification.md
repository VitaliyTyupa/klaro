# Перша реальна мовна оцінка

Дата: 2026-10-09. Evidence: [openai-run-v1.json](openai-run-v1.json), report ID `language-eval-e98a29bb-3299-4a89-b3d1-67e2c401f27f`.

Користувач погодив один прогін `gpt-4.1-mini-2025-04-14` із cap $2 та призначив reviewers через `deployment/reviewers.local.json`. Runner отримав cap `2000000` micro-USD явно, без зміни runtime `.env`. Policy: `openai-gpt41mini-policy-v1`, model policy: `openai-gpt41mini-model-v1`, prompt: `language-v5`, price: `openai-gpt41mini-price-2026-10-09`. Синтетичні fixtures: `synthetic-full-language-v1`; exact digests і versions збережені у JSON.

| Показник | Результат |
| --- | ---: |
| Commands із виконаним primary stage | 72 / 72 |
| Запланована верхня кількість stages | 96 |
| Фактичні provider calls | 80 |
| Contract passed | 63 |
| Contract failed | 17 |
| Похідні stages, пропущені після невдалого primary | 16 |
| Actual cost | 32204 micro-USD ($0,032204) |
| Estimated cost | 0 |
| Human review | pending |

Усі 80 calls повернули provider outcome `complete`; це не означає проходження application contract. Runner завершив обходження всіх commands, але вийшов із кодом 1 через contract failures. Приклади: порожній `recommendationId` у `de-facts` / `en-facts`, невалідний zero-length edit span у `uk-style`, заміна цифри `3` словом у `uk-facts`, яку поточна numeric validation відхиляє. Інші schema/domain failures містяться в evidence; ці автоматичні результати не є оцінкою мовної якості людиною.

`evaluation:signoff` локально перевірено на цьому звіті: export відхилено, reviewed policy не створено. Runtime activation не виконувалася, прихованих retries не було. Не редагувати machine evidence або outcomes, щоб зробити звіт успішним.

Призначені reviewers заповнюють лише `cases[].stages[].humanReview[language]`: критерії `pass`/`fail`, ISO `reviewedAt` і конкретні `notes` відповідно до [інструкцій](openai-starter.md). Призначення reviewer не замінює завершений review. Мовна readiness для `uk/de/en/vi` залишається `unreviewed`.

Задача 11.1 залишається відкритою: відсутній human review, кандидат має contract failures і неповне stage coverage. Наступний paid run потребує окремого погодження; невикористаний cap цього прогону не є дозволом на автоматичне повторення. Release gates 11.2–11.5 також ще відкриті.
