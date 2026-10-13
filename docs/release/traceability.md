# Requirement → test / evidence

Покрито 11 capabilities, 48 requirements і 60 scenarios. Таблиця прив'язує вимоги до технічних перевірок, а не оголошує всі мовні чи юридичні критерії безумовно успішними. Поточні результати й статус кожного run — [acceptance-run.json](acceptance-run.json); checklist — [release-checklist.md](release-checklist.md). Документ згенеровано `node tools/write-release-traceability.mjs`.

## account-management

| Вимога | Scenario | Технічні перевірки | Додаткове evidence / межі |
| --- | --- | --- | --- |
| Authenticated account and isolated sessions | Cross account access | [operations.integration.mjs](../../tests/operations.integration.mjs), [privacy.integration.mjs](../../tests/privacy.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Authenticated account and isolated sessions | Sign out | [sessions.integration.mjs](../../tests/sessions.integration.mjs), [correction.e2e.mjs](../../tests/correction.e2e.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Account workspace and settings | Preferences across clients | [preferences.browser.mjs](../../tests/preferences.browser.mjs), [sessions.integration.mjs](../../tests/sessions.integration.mjs), [browser-matrix.fixture.mjs](../../tests/browser-matrix.fixture.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Data export and account deletion | Confirm deletion | [privacy.integration.mjs](../../tests/privacy.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |

## ai-orchestration

| Вимога | Scenario | Технічні перевірки | Додаткове evidence / межі |
| --- | --- | --- | --- |
| Replaceable evaluated model policies | Switch model policy | [policies.test.mjs](../../tests/policies.test.mjs), [privacy.integration.mjs](../../tests/privacy.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Replaceable evaluated model policies | Initial acceptance with deferred findings | [initial-acceptance.test.mjs](../../tests/initial-acceptance.test.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Explicit acyclic workflows | Back translation completion | [provider-domain.test.mjs](../../tests/provider-domain.test.mjs), [native-rendering.test.mjs](../../tests/native-rendering.test.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Untrusted content isolation | Embedded malicious instruction | [result-validation.test.mjs](../../tests/result-validation.test.mjs), [openai-adapter.test.mjs](../../tests/openai-adapter.test.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Safe model failure handling | Invalid structured output | [openai-adapter.test.mjs](../../tests/openai-adapter.test.mjs), [result-validation.test.mjs](../../tests/result-validation.test.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |

## browser-extension

| Вимога | Scenario | Технічні перевірки | Додаткове evidence / межі |
| --- | --- | --- | --- |
| Cross browser panel activation | Shortcut unavailable | [chrome-activation.test.mjs](../../tests/chrome-activation.test.mjs), [firefox-activation.test.mjs](../../tests/firefox-activation.test.mjs), [firefox-package.browser.mjs](../../tests/firefox-package.browser.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| No page observation or injection | Typing on an unrelated page | [package-network.browser.mjs](../../tests/package-network.browser.mjs), [chrome-activation.test.mjs](../../tests/chrome-activation.test.mjs), [firefox-activation.test.mjs](../../tests/firefox-activation.test.mjs) | [Manifest/code audit](package-audit.md) підтверджує відсутність page access; network test охоплює власний редактор, а не читання сторонньої сторінки. |
| Packaged functionality and minimal permissions | Production package review | [package-network.browser.mjs](../../tests/package-network.browser.mjs) | [Recursive package audit](package-audit.json), [runtime network](package-network.json). |
| Lifecycle independent processing | Background process restarted | [chrome-lifecycle.browser.mjs](../../tests/chrome-lifecycle.browser.mjs), [extension-auth.test.mjs](../../tests/extension-auth.test.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |

## language-preferences

| Вимога | Scenario | Технічні перевірки | Додаткове evidence / межі |
| --- | --- | --- | --- |
| Native and writing language roles | Initial preferences | [contracts.test.mjs](../../tests/contracts.test.mjs), [sessions.integration.mjs](../../tests/sessions.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Native and writing language roles | Vietnamese native language | [contracts.test.mjs](../../tests/contracts.test.mjs), [browser-matrix.fixture.mjs](../../tests/browser-matrix.fixture.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Independent language switching | Switch writing language | [editor-preferences.test.mjs](../../tests/editor-preferences.test.mjs), [preferences.browser.mjs](../../tests/preferences.browser.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Language specific style and level | German formal correction | [correction-policy.test.mjs](../../tests/correction-policy.test.mjs), [browser-matrix.fixture.mjs](../../tests/browser-matrix.fixture.mjs) | [Мовне evidence прийнято із зауваженнями](../evaluations/initial-acceptance-and-follow-ups.md); fixtures не доводять семантичної точності. |
| Language specific style and level | Lower proficiency level | [correction-policy.test.mjs](../../tests/correction-policy.test.mjs), [alternatives.test.mjs](../../tests/alternatives.test.mjs) | [Мовне evidence прийнято із зауваженнями](../evaluations/initial-acceptance-and-follow-ups.md); fixtures не доводять семантичної точності. |

## lexical-reference

| Вимога | Scenario | Технічні перевірки | Додаткове evidence / межі |
| --- | --- | --- | --- |
| Explicit lookup and disambiguation | Ambiguous inflected form | [reference.integration.mjs](../../tests/reference.integration.mjs), [reference.browser.mjs](../../tests/reference.browser.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Compact sense based overview | Missing native translation | [reference.browser.mjs](../../tests/reference.browser.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Language and part of speech sections | Noun card | [reference.integration.mjs](../../tests/reference.integration.mjs), [reference.browser.mjs](../../tests/reference.browser.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Progressive section loading | Section transport error | [reference.browser.mjs](../../tests/reference.browser.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Explicit labeled AI supplements | Generated conjugation section | [reference.integration.mjs](../../tests/reference.integration.mjs), [reference.browser.mjs](../../tests/reference.browser.mjs) | [Мовне evidence прийнято із зауваженнями](../evaluations/initial-acceptance-and-follow-ups.md); fixtures не доводять семантичної точності. |
| Explicit labeled AI supplements | Entire entry missing | [reference.integration.mjs](../../tests/reference.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Visible provenance and contextual privacy | Generated translation of sourced example | [reference.integration.mjs](../../tests/reference.integration.mjs), [result-validation.test.mjs](../../tests/result-validation.test.mjs) | [Мовне evidence прийнято із зауваженнями](../evaluations/initial-acceptance-and-follow-ups.md); fixtures не доводять семантичної точності. |

## operation-processing

| Вимога | Scenario | Технічні перевірки | Додаткове evidence / межі |
| --- | --- | --- | --- |
| Equivalent transport contracts | Concurrent results | [operation-stream.test.mjs](../../tests/operation-stream.test.mjs), [operations.integration.mjs](../../tests/operations.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Idempotent acceptance and bounded recovery | Lost acknowledgement | [operations.integration.mjs](../../tests/operations.integration.mjs), [editor-transport.test.mjs](../../tests/editor-transport.test.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Idempotent acceptance and bounded recovery | Provider outcome unknown | [recovery.integration.mjs](../../tests/recovery.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Atomic quotas and bounded work | Simultaneous quota exhaustion | [budgets.integration.mjs](../../tests/budgets.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Usage and activity metadata | Correction with explanation | [explanation.test.mjs](../../tests/explanation.test.mjs), [budgets.integration.mjs](../../tests/budgets.integration.mjs), [operations.integration.mjs](../../tests/operations.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Partial failure and cancellation | Cancel pending stages | [recovery.integration.mjs](../../tests/recovery.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |

## privacy-and-release

| Вимога | Scenario | Технічні перевірки | Додаткове evidence / межі |
| --- | --- | --- | --- |
| Processing disclosure and user control | First remote operation | [processing-consent.test.mjs](../../tests/processing-consent.test.mjs), [editor.browser.mjs](../../tests/editor.browser.mjs), [chrome-lifecycle.browser.mjs](../../tests/chrome-lifecycle.browser.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Text minimization and retention boundaries | Temporary result expired | [payloads.integration.mjs](../../tests/payloads.integration.mjs), [operations.integration.mjs](../../tests/operations.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Security boundaries | Malicious returned markup | [reference.browser.mjs](../../tests/reference.browser.mjs), [result-validation.test.mjs](../../tests/result-validation.test.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Release readiness evidence | Unresolved release condition | [reference-admission.test.mjs](../../tests/reference-admission.test.mjs), [processing-consent.test.mjs](../../tests/processing-consent.test.mjs) | [Legal release blocker](privacy-licensing-review.md) залишається. |
| Safe operational observability | Provider cost incident | [budgets.integration.mjs](../../tests/budgets.integration.mjs), [privacy.integration.mjs](../../tests/privacy.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |

## reference-data-management

| Вимога | Scenario | Технічні перевірки | Додаткове evidence / межі |
| --- | --- | --- | --- |
| Licensed source admission | Unapproved dataset | [reference-admission.test.mjs](../../tests/reference-admission.test.mjs), [reference.integration.mjs](../../tests/reference.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Structured lexical identity | Multiple source entries | [reference.integration.mjs](../../tests/reference.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Repeatable staged updates | Interrupted import | [reference.integration.mjs](../../tests/reference.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Source and generated data separation | Source fills a previous gap | [reference.integration.mjs](../../tests/reference.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Coverage reporting without personal dictionary | User corrects a paragraph | [reference.integration.mjs](../../tests/reference.integration.mjs), [operations.integration.mjs](../../tests/operations.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |

## text-correction

| Вимога | Scenario | Технічні перевірки | Додаткове evidence / межі |
| --- | --- | --- | --- |
| Meaning preserving correction | Already correct text | [result-validation.test.mjs](../../tests/result-validation.test.mjs), [editor.browser.mjs](../../tests/editor.browser.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Meaning preserving correction | Protected wording | [correction-policy.test.mjs](../../tests/correction-policy.test.mjs), [result-validation.test.mjs](../../tests/result-validation.test.mjs) | [Мовне evidence прийнято із зауваженнями](../evaluations/initial-acceptance-and-follow-ups.md); fixtures не доводять семантичної точності. |
| Explicit paraphrasing and alternatives | Select alternative | [alternatives.test.mjs](../../tests/alternatives.test.mjs), [editor.browser.mjs](../../tests/editor.browser.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Explicit paraphrasing and alternatives | Exhaust alternatives | [alternatives.test.mjs](../../tests/alternatives.test.mjs), [editor.browser.mjs](../../tests/editor.browser.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Individual change review | Reject one change | [edit-review.test.mjs](../../tests/edit-review.test.mjs), [editor.browser.mjs](../../tests/editor.browser.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| On demand explanation | Explain selected recommendation | [explanation.test.mjs](../../tests/explanation.test.mjs), [editor.browser.mjs](../../tests/editor.browser.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Automatic native language rendering | Back translation failure | [native-rendering.test.mjs](../../tests/native-rendering.test.mjs), [browser-matrix.fixture.mjs](../../tests/browser-matrix.fixture.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Automatic native language rendering | Recommendation changed during translation | [native-rendering.test.mjs](../../tests/native-rendering.test.mjs), [alternatives.test.mjs](../../tests/alternatives.test.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |

## text-translation

| Вимога | Scenario | Технічні перевірки | Додаткове evidence / межі |
| --- | --- | --- | --- |
| Native anchored translation directions | Reverse direction | [translation-editor.test.mjs](../../tests/translation-editor.test.mjs), [browser-matrix.fixture.mjs](../../tests/browser-matrix.fixture.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Native anchored translation directions | Unsupported cross language request | [translation-policy.test.mjs](../../tests/translation-policy.test.mjs), [translation.integration.mjs](../../tests/translation.integration.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Communicative fidelity | Ambiguous source | [translation-policy.test.mjs](../../tests/translation-policy.test.mjs), [editor.browser.mjs](../../tests/editor.browser.mjs) | [Мовне evidence прийнято із зауваженнями](../evaluations/initial-acceptance-and-follow-ups.md); fixtures не доводять семантичної точності. |
| Explicit contextual boundaries | Selected fragment with context | [translation.integration.mjs](../../tests/translation.integration.mjs), [editor-selection.test.mjs](../../tests/editor-selection.test.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |

## text-workspace

| Вимога | Scenario | Технічні перевірки | Додаткове evidence / межі |
| --- | --- | --- | --- |
| Manual editor and bounded input | Panel limit exceeded | [editor-limits.test.mjs](../../tests/editor-limits.test.mjs), [editor.browser.mjs](../../tests/editor.browser.mjs), [browser-matrix.fixture.mjs](../../tests/browser-matrix.fixture.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Selection scoped processing | Selected sentence | [editor-selection.test.mjs](../../tests/editor-selection.test.mjs), [browser-matrix.fixture.mjs](../../tests/browser-matrix.fixture.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Controlled execution and revision safety | Stale response | [editor-scheduler.test.mjs](../../tests/editor-scheduler.test.mjs), [editor-transport.test.mjs](../../tests/editor-transport.test.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Controlled execution and revision safety | Pause automatic processing | [editor-scheduler.test.mjs](../../tests/editor-scheduler.test.mjs), [chrome-lifecycle.browser.mjs](../../tests/chrome-lifecycle.browser.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Copy and temporary draft recovery | Recover original | [editor-originals.test.mjs](../../tests/editor-originals.test.mjs), [editor.browser.mjs](../../tests/editor.browser.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Copy and temporary draft recovery | Clipboard failure | [editor.browser.mjs](../../tests/editor.browser.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
| Accessible result presentation | Keyboard review | [editor.browser.mjs](../../tests/editor.browser.mjs), [reference.browser.mjs](../../tests/reference.browser.mjs) | [Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture. |
