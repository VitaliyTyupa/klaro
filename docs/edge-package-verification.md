# Edge package та browser smoke procedure

`npm run package:edge` створює окремий `dist/packages/edge`; development package — `npm run package:edge:development`. Backend origin передається безпосередньо packager: `node tools/package-extension.mjs --browser=edge --origin=https://your-backend.example`. Default `https://klaro.example` — placeholder. Обидва packages використовують спільні Angular AOT assets та Chromium activation adapter; worker володіє лише відкриттям панелі. Microsoft документує [chrome.sidePanel для Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/sidebar) та [identity.launchWebAuthFlow](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support). Shared UI отримує identity через browser port і не читає сторінку.

Manifest має тільки `sidePanel`, `identity` та host permission для exact backend origin. Немає content scripts, `tabs`, `activeTab`, `scripting` або storage permission. CSP дозволяє локальні scripts та exact HTTP/WebSocket backend. Package не містить remote executable assets.

Потрібні встановлений desktop Microsoft Edge, Xvfb / xdotool для native hotkey і локальні PostgreSQL / Redis. `EDGE_EXECUTABLE_PATH` задає інший шлях до справжнього Edge; test не підміняє його Chrome.

```sh
npm run package:edge
KLARO_BROWSER_HEADED=1 xvfb-run -a npm run test:edge-package
npm run test:edge-correction-e2e
```

Package smoke має перевірити AOT / CSP, action → native panel, native Alt+Shift+K після закриття panel, identity API і manual editor. Shortcut змінюється у `edge://extensions/shortcuts`; action доступний при конфлікті hotkey. Headless package test не закриває native hotkey gate.

Correction E2E використовує справжній native panel, `identity.launchWebAuthFlow` з локальним signed OIDC provider, один synthetic account для panel / web, backend provider double і native clipboard write. Перевіряє два attempts correction / native rendering, reconnect без повторного acceptance, quota refusal, logout, pending debounce cleanup та close / reopen без draft / token. Test-only fixtures не входять у package. Продакшн OIDC конфігурація повинна allowlist точний callback, отриманий `chrome.identity.getRedirectURL('klaro')` у встановленому Edge; ID іншого browser / store package не слід припускати однаковим.

**Статус: real browser gate пройшов.** Edge **155.0.4283.45** перевірено package smoke у Xvfb/X11: action створює native panel document, закриття знищує його, Alt+Shift+K відкриває новий document. Edge не призначав початковий Ctrl+Shift+K, тому default для Edge — Alt+Shift+K; Chrome default залишається Ctrl+Shift+K. Panel містить visible shortcut-settings path.

`KLARO_BROWSER=edge node --env-file-if-exists=.env tests/correction.e2e.mjs` пройшов із native identity / signed OIDC, correction / native rendering, native clipboard, forced socket reconnect без нового acceptance, quota refusal, logout та close / reopen із pending debounce. Дані synthetic; paid AI calls не виконувалися. Test перевіряє фактичні panel targets, оскільки Edge у цьому environment не надсилав очікуваний `onOpened` event.
