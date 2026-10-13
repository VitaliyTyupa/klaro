# Матеріали магазинів — підготовлений draft

Підготовлено й звірено з реалізацією та правилами 2026-10-13. Публікація не виконувалася. Однакова функціональна основа для Chrome Web Store, Edge Add-ons та Firefox AMO; UI першої версії українською, каталог мов тексту `uk/de/en/vi`.

## Назва та короткий опис

Назва: **Klaro**.

Короткий опис: **Корекція та переклад тексту, який ви вводите або вставляєте вручну.**

Single purpose: **Допомога в написанні й розумінні іншомовного тексту у власному мовному редакторі: корекція, переклад і довідка про слова.**

## Повний опис для трьох магазинів

Klaro відкриває мовний редактор у бічній панелі браузера. Введіть або вставте свій текст, оберіть мову й запустіть корекцію або переклад. Потрібен обліковий запис; обробка використовує backend Klaro та OpenAI.

Коректор показує оригінал, рекомендацію та її переклад основною мовою. Можна прийняти або відхилити правки, окремо запросити перефразування чи пояснення. Якщо правок немає, повертається оригінал. «Ще варіанти» показує по черзі щонайбільше три альтернативи з одного набору.

Перекладач працює між вашою основною мовою та обраною мовою письма. Підтримувані мови тексту: українська, німецька, англійська й в'єтнамська. Довідник відкривається лише за вашим запитом, показує доступні значення, форми й походження даних; доповнення ШІ позначаються як неперевірені.

Панель приймає до 5000 символів Unicode; вебредактор — до 20000. Результат можна скопіювати вручну. Автоматична перевірка після паузи вводу вмикається лише вами. Перед першим надсиланням показується пояснення обробки даних. Оцінкою результату можна поділитися добровільно; feedback передає категорію та ідентифікатор операції без тексту.

Klaro не читає сторонніх сторінок або полів, не відстежує історію браузера й не вставляє результат у чужі форми. Чернетки не мають постійної історії; тимчасові результати доступні обмежений час. ШІ може помилятися: перевіряйте важливі факти й формулювання. Аудіо, Teams, зображення, персональний словник і навчальна статистика до цієї версії не входять.

## Обґрунтування дозволів

| Дозвіл | Обґрунтування |
| --- | --- |
| Chromium `sidePanel` | Власний редактор у бічній панелі; toolbar action і browser command відкривають його. |
| `identity` | Явний вхід через browser identity flow та одноразовий exchange; application token лише в memory. |
| Host permission одного backend | Authenticated HTTP/socket до Klaro для обраних користувачем операцій, налаштувань і довідки. Не надає загального доступу до сайтів. |
| Firefox data categories | `authenticationInfo`, `personalCommunications`, `personallyIdentifyingInfo`: auth/session, власний текст, account/profile. Вони є деклараціями передавання, а не дозволами читання сторонніх сторінок. |

## Data disclosures для dashboard

Account/profile/preferences та authentication information обробляються для входу й збереження налаштувань. Введений або виділений у власному редакторі текст, bounded context і рекомендація передаються backend та OpenAI для явної операції; live mode — лише opt-in. Public lexical queries надсилаються backend за запитом користувача. Operation/usage metadata й добровільні категорії feedback зберігаються без приватного тексту. Auth flow також передає потрібні дані налаштованому OIDC provider; його назву й політику треба вписати після вибору deployment.

Не заявляти «не збирає жодних даних» або «zero retention»: Redis payload до 30 хв, результат до 15 хв після завершення в межах 30 хв; HMAC 24 год, metadata/feedback 30 днів, context-free supplements 7 днів, deletion journal 35 днів. Provider retention розкривається окремо за налаштуваннями account. Немає реклами, продажу даних, page tracking, прихованого vocabulary harvesting або persistent текстової історії. На вебсайті треба розмістити точне Limited Use statement після підтвердження фактичної операторської практики.

## Screenshots

Підготовлено PNG 1280×800 з реального спільного web UI: [корекція](screenshots/correction-web.png), [переклад](screenshots/translation-web.png). Візуально перевірено: текст читабельний, області вводу та результату видимі, приклади відповідають мовам uk/de. Відповіді задані deterministic demo fixtures, а не отримані від OpenAI; це демонстрація інтерфейсу, а не мовної якості. Web navigation не видається за native sidebar. Перед submission додати native captures кінцевого package на production-конфігурації без приватних даних.

Відтворення: `KLARO_RELEASE_SCREENSHOTS=1 node tests/editor.browser.mjs` після build.

## Звірка правил і незаповнені поля

[Chrome policies](https://developer.chrome.com/docs/webstore/program-policies/policies) вимагають вузьких дозволів, точних disclosures, privacy URL і single-purpose опису. [Chrome images](https://developer.chrome.com/docs/webstore/images) описують screenshot/promotion assets; остаточні розміри й наявність полів звірити в dashboard. [Edge publication](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension) допускає screenshots 1280×800 та вимагає listing/logo. [Firefox policies](https://extensionworkshop.com/documentation/publish/add-on-policies/) вимагають точного data consent/manifest disclosure та можливості відтворити packaged code. Firefox minimum 140 і required data categories відповідають поточному підходу built-in consent; first-send disclosure додатково залишається.

Перед публікацією: визначити production backend/privacy/support URLs та operator contact, кінцеві store IDs/auth callbacks, logo/icon assets, OIDC provider і фактичні provider controls; перепакувати, повторити audit та native captures, підготувати source archive і build instructions для AMO. Поточні опис і disclosures не обіцяють автоматичної юридичної відповідності чи схвалення магазинами.
