import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { admitSource, contentHash, exampleAdmission } from '../apps/reference-import/src/admission.ts';
const manifest = JSON.parse(readFileSync('reference/sources/kaikki-en.json', 'utf8'));

test('source license covers admitted data without a per-record license field', () => {
  assert.equal(admitSource(manifest).license, 'CC-BY-SA-4.0');
  for (const patch of [{ license: 'unknown' }, { rightsStatus: 'unknown' }, { rightsStatus: 'revoked' }, { downloadUrl: 'https://unapproved.test/data' }, { sourceId: 'dict.cc' }]) assert.throws(() => admitSource({ ...manifest, ...patch }));
});
test('unknown examples are excluded independently; exact evidence admits a fragment', () => {
  const example = { text: 'A synthetic example.', type: 'example' };
  assert.equal(exampleAdmission(example, manifest).reason, 'example-rights-unknown');
  assert.equal(exampleAdmission({ ...example, ref: 'A synthetic publication' }, manifest).reason, 'quotation-unverified');
  const reviewed = { ...manifest, exampleEvidence: [{ contentHash: contentHash(example), license: 'CC0-1.0', evidenceUrl: 'https://synthetic.test/evidence', attribution: 'Klaro synthetic fixture authors' }] };
  assert.equal(exampleAdmission(example, admitSource(reviewed)).admitted, true);
  assert.equal(exampleAdmission({ ...example, text: 'A changed example.' }, reviewed).admitted, false);
  assert.equal(exampleAdmission({ ...example, rights_status: 'forbidden' }, reviewed).admitted, false);
});
