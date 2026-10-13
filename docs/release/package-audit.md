# Аудит пакетів браузерів

Перевірено 2026-10-13 після фінального build. Машинні результати: [статичний аудит](package-audit.json), [мережеві спостереження](package-network.json). Hash кожного packaged file записано для прив'язки до перевіреної збірки.

Chrome і Edge мають лише `sidePanel`, `identity` та host permission одного backend origin. Firefox має `identity`, sidebar adapter і той самий host permission; його data collection categories відповідають входу, профілю та введеному тексту. У всіх пакетах відсутні content scripts, optional permissions, page injection, clipboard read, history access, remote script loaders, eval, source maps і provider secrets; AOT chunks та styles локальні. CSP дозволяє executable code лише з пакета, а connect — backend HTTPS/WSS.

Мережевий сценарій виконано на реальних Chrome 154.0.8037.57, Edge 155.0.4283.45 і Firefox 157.0.1: відкриття production editor/sidebar, ручний набір synthetic canary без входу й надсилання. Передавання введеного тексту не відбулося; persistent local/session storage порожні. Firefox observer працює лише у привілейованому test harness і не входить до пакета.

Observer self-check виконує окремий harness-only GET canary до placeholder origin і вимагає, щоб інструментація його виявила. Цей probe не є функцією розширення й не входить у trace сценарію ручного вводу; поле `observerVerified` фіксує перевірку спостерігача.

Це scoped audit, а не доказ усіх можливих мережевих трас. Authenticated OIDC/correction/translation, reconnect, clipboard і cleanup перевіряються окремими локальними browser tests із provider double; попередня [матриця браузерів](../browser-matrix-verification.md) містить точні версії та результати. Відсутність page-access permissions, content scripts і page APIs підтверджує межу ручного вводу.

Пакети використовують `https://klaro.example`, зарезервований placeholder. Перед реальним випуском потрібні production origin, callback/Origin allowlists, HTTPS, повторний package/network audit саме кінцевого пакета та налаштована privacy page. Поточний audit не перевіряє доступність цього backend і не є публікацією.

Відтворення:

```sh
npm run build
node tools/package-extension.mjs --browser=chrome
node tools/package-extension.mjs --browser=edge
node tools/package-extension.mjs --browser=firefox
node tools/audit-extension-packages.mjs
KLARO_BROWSER_HEADED=1 GECKODRIVER_PATH=/path/to/geckodriver FIREFOX_EXECUTABLE_PATH=/path/to/firefox xvfb-run -a node tests/package-network.browser.mjs
```
