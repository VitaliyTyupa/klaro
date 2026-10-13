# Firefox package та native browser evidence

`npm run package:firefox` створює `dist/packages/firefox`; development target — `dist/packages/firefox-development`. Це MV3 із `sidebar_action`, `action`, `identity` та exact backend host permission. Firefox adapter використовує `browser.action`, `browser.commands` і `browser.sidebarAction`; Chromium service worker / sidePanel не входять у package. UI assets спільні, локальні та AOT. Background не володіє draft, token або socket. Немає content scripts, page-read / injection / storage permissions.

Дотримано [Firefox sidebar API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/Sidebars) та [MV3 background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background). Gecko ID `klaro@klaro.local` є development ID, не AMO publication claim. Minimum 140 дозволяє [built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/); required data categories описують account authentication та власний введений текст. Остаточний store / privacy review залишається у release tasks 11.3–11.4; передачу private input регулюватиме також first-send disclosure task 10.1.

**Real browser checks пройшли на Firefox 157.0.1**, official Mozilla Linux archive, geckodriver **0.37.1**. Native sidebar виконує signed local OIDC через `browser.identity.launchWebAuthFlow`, два correction / native attempts із provider double, native clipboard write, logout із server revocation та clear input. Закриття з pending debounce знищує document; toolbar action створює новий без input / token. Через 1200 ms operation count залишається один. Native Alt+Shift+K відкриває sidebar у Xvfb/X11. No-copy action у native rendering, session/local storage порожні; приватний synthetic text не входить у API log.

HTTP CORS тепер дозволяє тільки APP_ORIGIN та explicitly configured EXTENSION_ORIGINS, із `credentials: false`, bounded methods / headers. Test перевіряє preflight для власного `moz-extension` origin та відсутність дозволу для unrelated synthetic origin. Bearer authorization перевіряється окремо. Callback для deployment потрібно отримати саме `browser.identity.getRedirectURL('klaro')` та включити точний URL у EXTENSION_CALLBACKS; не припускається Chromium callback або однаковий ID між packages.

Test fixture використовує [geckodriver privileged UI mode](https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html) і Marionette actor тільки для власного remote sidebar document. Привілейований automation code не входить у extension. Temporary profiles створюються у ignored `dist/firefox-test-profiles`, доступному snap та native Firefox. Звичайні / сторонні сторінки не читаються.

```sh
npm run build
KLARO_BROWSER_HEADED=1 GECKODRIVER_PATH=/snap/firefox/current/usr/lib/firefox/geckodriver FIREFOX_EXECUTABLE_PATH=/home/vitalik/Projects/klaro/dist/test-browsers/firefox/firefox xvfb-run -a npm run test:firefox-package
```

Шляхи до Firefox / geckodriver налаштовуються через env; test не підміняє Firefox іншим engine. Системний snap Firefox **156.0.1** завантажував package headless, але не відкривав Xvfb display. Повний gate виконано з Mozilla archive у ignored `dist/test-browsers`; ці binaries не входять у build або git. Без headed mode test явно залишає native hotkey gate pending. Shortcut налаштовується в `about:addons → ⚙ → Керування комбінаціями клавіш`, шлях показано у panel; toolbar action доступний при конфлікті комбінації.
