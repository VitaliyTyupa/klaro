# Chrome package: локальна перевірка

`npm run package:chrome` створює MV3 package у `dist/packages/chrome` з Angular production AOT assets. Backend origin задається під час packaging, наприклад `npm run package:chrome -- --origin=https://klaro.example`. Значення за замовчуванням є placeholder; працюючий backend не налаштований. Development package створюється командою `npm run package:chrome:development`.

Permissions: `sidePanel`, `identity` і один backend origin. Content scripts, `tabs`, `activeTab`, `scripting` та remote executable assets відсутні. Service worker лише налаштовує action і обробляє `open-klaro`, передаючи window ID у side panel API.

На Chrome **154.0.8037.57** виконано `npm run test:chrome-package`: справжній unpacked package завантажився, Angular editor працює з CSP, доступний identity API, action відкриває side panel, command має призначений shortcut. `node --test tests/chrome-activation.test.mjs` перевіряє синхронний command handler і відсутність читання URL/title. Дані тестів синтетичні; зовнішні AI calls та публікація не виконувалися.

**Native hotkey перевірений** на Chrome 154.0.8037.57 через Xvfb/X11 і xdotool. Test чекає фактичного закриття panel перед Ctrl+Shift+K та підтверджує наступний `sidePanel.onOpened`. Playwright keyboard events самі по собі не активують browser accelerator. Для повторення:

```bash
sudo apt-get install -y xvfb xdotool
KLARO_CHROME_HEADED=1 xvfb-run -a npm run test:chrome-package
```

Headless test перевіряє action та призначення shortcut і явно пропускає native hotkey gate; для повної перевірки потрібен наведений headed command. Chrome примусово використовує X11, щоб тест не відкривав window на користувацькому Wayland desktop. Shortcut можна змінити в `chrome://extensions/shortcuts`; якщо він не призначений або конфліктує, action залишається доступним.

## Panel lifecycle

`npm run test:chrome-lifecycle` пройшов на Chrome **154.0.8037.57** зі справжнім development package, локальним synthetic HTTP / Socket.IO server та підміною тільки identity dialog у test fixture. Окремий `npm run test:correction-e2e` також пройшов із native identity та signed OIDC flow, справжнім panel, native clipboard, reconnect, quota refusal, logout і close / reopen; evidence наведено в [correction verification](correction-verification.md).

Socket і application token належать panel document. Worker не імпортує transport, auth або editor. CDP зупиняє й запускає справжній extension service worker під час running operation: panel socket залишається активним, input зберігається, новий accept не відправляється. Pause відключає socket і скасовує поточну operation один раз; після цього automatic requests відсутні. Native panel close очищає token, input і originals, відключає socket; reload починається з порожнього editor та без token / storage. Один cancellation request під час cleanup допустимий; після його завершення test підтверджує стабільний request count.

`tests/editor-transport.test.mjs` перевіряє sequence gaps, duplicate events, reconnect snapshot без повторного accept, пізні responses і socket initialization після close. Auth передається як handshake data, оскільки browser WebSockets не дозволяють custom Authorization headers: [Socket.IO client options](https://socket.io/docs/v4/client-options/). Socket.IO включений у локальний lazy chunk, а не завантажується з мережі.
