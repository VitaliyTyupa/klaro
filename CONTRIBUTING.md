# Правила розробки

Identifiers, назви файлів, API fields, technical headings, code comments і test names пишемо англійською. README, пояснення архітектури та робочі обговорення — українською.

Користувацькі тексти зберігаємо в ресурсах `packages/language-profiles/src/locales/`; початковий UI locale — `uk`. Компоненти використовують ключі ресурсів, а не вбудовані тексти. UI locale та основна мова / мова письма користувача — незалежні поняття.

Технічні значення (`uk`, `de`, `en`, `vi`, майбутні operation types і status codes) стабільні та англійські. Не використовуємо локалізовані підписи як enum values або API identifiers. Для відображення додаємо окремий mapping у locale resource. Серверні діагностичні повідомлення не є UI текстами.

Клієнтська логіка живе в `apps/web`, `apps/extension`, `packages/editor`, `packages/contracts` та `packages/language-profiles`. Ці області не імпортують серверні entry points, database drivers, provider SDK або Node.js built-ins. Перевірку меж не вимикаємо для обходу помилки; переміщуємо спільний контракт у відповідний client-safe package.

Залежності фіксуємо точними версіями з lockfile; зміни перевіряємо через `npm run ci`. Приватні тексти, credentials та чернетки не включаємо до fixtures, журналів, Git або URL. Для тестів використовуємо синтетичні дані.
