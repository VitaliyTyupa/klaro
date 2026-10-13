import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { checkSource } from '../tools/check-boundaries.mjs';

const file = resolve('apps/web/src/boundary-probe.ts');

test('client imports accept shared contracts and Angular', () => {
  assert.deepEqual(checkSource(file, "import { CONTRACT_VERSION } from '@klaro/contracts'; import { Component } from '@angular/core';"), []);
});

for (const source of [
  "import '../../api/src/main';",
  "export * from '../../api/src/main';",
  "import('@nestjs/core');",
  "const fs = require('node:fs');",
  "type Server = import('../../api/src/main');",
  "import(process.env.MODULE);",
  "import { main } from '../../reference-import/src/main';",
  "import '@angular/build';",
  "import 'socket.io-client/server';",
]) {
  test(`client rejects server module access: ${source}`, () => {
    assert.ok(checkSource(file, source).length > 0);
  });
}
