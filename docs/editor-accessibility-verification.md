# Перевірка accessibility editor

Оновлення 2026-10-13: acceptance і screenshot-сценарії виявили недостатній контраст текстової Material button у фокусі. Обидва клієнти використовують темніший text-label color `#004f9e`; повторні shared web/panel checks із Axe, keyboard navigation та активними результатами пройшли. Release screenshots мають узгоджені demo приклади uk/de; кінцеві результати прогону — `docs/release/acceptance-run.json`.

`npm run test:editor-ui` пройшов на Chrome **154.0.8037.57**. Axe-core **4.13.0** не знайшов violations у web / panel layouts, web result та diff presentation. Перевірено keyboard-only перехід до запуску через Tab, запуск Enter, видимий outline, збереження фокусу після асинхронного результату, підписи readonly областей, live result status і текстові «Було / Стало» біля `del` / `ins`. Native rendering не має copy action.

Busy run action має `aria-disabled`; scheduler відхиляє повторний запуск, а browser не втрачає фокус через native disabled state. Status region існує до запиту й має `aria-live="polite"`, `aria-atomic="true"`. Автоматичні responses не викликають focus; лише явний clipboard fallback виділяє результат за дією користувача.

Результати синтетичні. Automated audit не підтверджує повну відповідність accessibility standards або поведінку всіх screen readers; ручна перевірка фінального release залишається у task 11.5.
