import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const cases = {
  'Cross account access': ['operations.integration.mjs', 'privacy.integration.mjs'],
  'Sign out': ['sessions.integration.mjs', 'correction.e2e.mjs'],
  'Preferences across clients': ['preferences.browser.mjs', 'sessions.integration.mjs', 'browser-matrix.fixture.mjs'],
  'Confirm deletion': ['privacy.integration.mjs'],
  'Switch model policy': ['policies.test.mjs', 'privacy.integration.mjs'],
  'Initial acceptance with deferred findings': ['initial-acceptance.test.mjs'],
  'Back translation completion': ['provider-domain.test.mjs', 'native-rendering.test.mjs'],
  'Embedded malicious instruction': ['result-validation.test.mjs', 'openai-adapter.test.mjs'],
  'Invalid structured output': ['openai-adapter.test.mjs', 'result-validation.test.mjs'],
  'Shortcut unavailable': ['chrome-activation.test.mjs', 'firefox-activation.test.mjs', 'firefox-package.browser.mjs'],
  'Typing on an unrelated page': ['package-network.browser.mjs', 'chrome-activation.test.mjs', 'firefox-activation.test.mjs'],
  'Production package review': ['package-network.browser.mjs'],
  'Background process restarted': ['chrome-lifecycle.browser.mjs', 'extension-auth.test.mjs'],
  'Initial preferences': ['contracts.test.mjs', 'sessions.integration.mjs'],
  'Vietnamese native language': ['contracts.test.mjs', 'browser-matrix.fixture.mjs'],
  'Switch writing language': ['editor-preferences.test.mjs', 'preferences.browser.mjs'],
  'German formal correction': ['correction-policy.test.mjs', 'browser-matrix.fixture.mjs'],
  'Lower proficiency level': ['correction-policy.test.mjs', 'alternatives.test.mjs'],
  'Ambiguous inflected form': ['reference.integration.mjs', 'reference.browser.mjs'],
  'Missing native translation': ['reference.browser.mjs'],
  'Noun card': ['reference.integration.mjs', 'reference.browser.mjs'],
  'Section transport error': ['reference.browser.mjs'],
  'Generated conjugation section': ['reference.integration.mjs', 'reference.browser.mjs'],
  'Entire entry missing': ['reference.integration.mjs'],
  'Generated translation of sourced example': ['reference.integration.mjs', 'result-validation.test.mjs'],
  'Concurrent results': ['operation-stream.test.mjs', 'operations.integration.mjs'],
  'Lost acknowledgement': ['operations.integration.mjs', 'editor-transport.test.mjs'],
  'Provider outcome unknown': ['recovery.integration.mjs'],
  'Simultaneous quota exhaustion': ['budgets.integration.mjs'],
  'Correction with explanation': ['explanation.test.mjs', 'budgets.integration.mjs', 'operations.integration.mjs'],
  'Cancel pending stages': ['recovery.integration.mjs'],
  'First remote operation': ['processing-consent.test.mjs', 'editor.browser.mjs', 'chrome-lifecycle.browser.mjs'],
  'Temporary result expired': ['payloads.integration.mjs', 'operations.integration.mjs'],
  'Malicious returned markup': ['reference.browser.mjs', 'result-validation.test.mjs'],
  'Unresolved release condition': ['reference-admission.test.mjs', 'processing-consent.test.mjs'],
  'Provider cost incident': ['budgets.integration.mjs', 'privacy.integration.mjs'],
  'Unapproved dataset': ['reference-admission.test.mjs', 'reference.integration.mjs'],
  'Multiple source entries': ['reference.integration.mjs'],
  'Interrupted import': ['reference.integration.mjs'],
  'Source fills a previous gap': ['reference.integration.mjs'],
  'User corrects a paragraph': ['reference.integration.mjs', 'operations.integration.mjs'],
  'Already correct text': ['result-validation.test.mjs', 'editor.browser.mjs'],
  'Protected wording': ['correction-policy.test.mjs', 'result-validation.test.mjs'],
  'Select alternative': ['alternatives.test.mjs', 'editor.browser.mjs'],
  'Exhaust alternatives': ['alternatives.test.mjs', 'editor.browser.mjs'],
  'Reject one change': ['edit-review.test.mjs', 'editor.browser.mjs'],
  'Explain selected recommendation': ['explanation.test.mjs', 'editor.browser.mjs'],
  'Back translation failure': ['native-rendering.test.mjs', 'browser-matrix.fixture.mjs'],
  'Recommendation changed during translation': ['native-rendering.test.mjs', 'alternatives.test.mjs'],
  'Reverse direction': ['translation-editor.test.mjs', 'browser-matrix.fixture.mjs'],
  'Unsupported cross language request': ['translation-policy.test.mjs', 'translation.integration.mjs'],
  'Ambiguous source': ['translation-policy.test.mjs', 'editor.browser.mjs'],
  'Selected fragment with context': ['translation.integration.mjs', 'editor-selection.test.mjs'],
  'Panel limit exceeded': ['editor-limits.test.mjs', 'editor.browser.mjs', 'browser-matrix.fixture.mjs'],
  'Selected sentence': ['editor-selection.test.mjs', 'browser-matrix.fixture.mjs'],
  'Stale response': ['editor-scheduler.test.mjs', 'editor-transport.test.mjs'],
  'Pause automatic processing': ['editor-scheduler.test.mjs', 'chrome-lifecycle.browser.mjs'],
  'Recover original': ['editor-originals.test.mjs', 'editor.browser.mjs'],
  'Clipboard failure': ['editor.browser.mjs'],
  'Keyboard review': ['editor.browser.mjs', 'reference.browser.mjs'],
};
const semantic = new Set(['German formal correction', 'Lower proficiency level', 'Protected wording', 'Ambiguous source', 'Generated conjugation section', 'Generated translation of sourced example']);
const root = 'openspec/changes/build-klaro-platform/specs';
const rows = []; let scenarios = 0; let requirements = 0;
for (const capability of (await readdir(root)).sort()) {
  const source = await readFile(`${root}/${capability}/spec.md`, 'utf8'); let requirement;
  rows.push(`\n## ${capability}\n\n| Вимога | Scenario | Технічні перевірки | Додаткове evidence / межі |\n| --- | --- | --- | --- |`);
  for (const line of source.split('\n')) {
    if (line.startsWith('### Requirement: ')) { requirement = line.slice(17); requirements++; }
    if (!line.startsWith('#### Scenario: ')) continue;
    const scenario = line.slice(15); const files = cases[scenario]; assert.ok(files, `Missing traceability: ${scenario}`); assert.ok(requirement);
    for (const file of files) await readFile(`tests/${file}`);
    const note = semantic.has(scenario) ? '[Мовне evidence прийнято із зауваженнями](../evaluations/initial-acceptance-and-follow-ups.md); fixtures не доводять семантичної точності.' : scenario === 'Unresolved release condition' ? '[Legal release blocker](privacy-licensing-review.md) залишається.' : scenario === 'Typing on an unrelated page' ? '[Manifest/code audit](package-audit.md) підтверджує відсутність page access; network test охоплює власний редактор, а не читання сторонньої сторінки.' : scenario === 'Production package review' ? '[Recursive package audit](package-audit.json), [runtime network](package-network.json).' : '[Acceptance run](acceptance-run.json); unit checks входять у CI, browser matrix викликає fixture.';
    rows.push(`| ${requirement} | ${scenario} | ${files.map(file => `[${file}](../../tests/${file})`).join(', ')} | ${note} |`); scenarios++;
  }
}
assert.equal(rows.filter(row => row.startsWith('\n## ')).length, 11);
await writeFile('docs/release/traceability.md', `# Requirement → test / evidence\n\nПокрито 11 capabilities, ${requirements} requirements і ${scenarios} scenarios. Таблиця прив'язує вимоги до технічних перевірок, а не оголошує всі мовні чи юридичні критерії безумовно успішними. Поточні результати й статус кожного run — [acceptance-run.json](acceptance-run.json); checklist — [release-checklist.md](release-checklist.md). Документ згенеровано \`node tools/write-release-traceability.mjs\`.\n${rows.join('\n')}\n`);
console.info(`Traceability: 11 capabilities, ${requirements} requirements, ${scenarios} scenarios`);
