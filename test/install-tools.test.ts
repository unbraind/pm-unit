import test from 'node:test';
import assert from 'node:assert/strict';
import { packedRequirement } from './install-tools.ts';
test('packed acceptance names unsupported platforms and missing tools without skipping release proof', () => {
  assert.match(packedRequirement('win32')!, /requires POSIX/);
  assert.match(packedRequirement('linux', ['npm', 'npx'])!, /requires bun/);
  assert.match(packedRequirement('linux', ['bun', 'npx'])!, /requires npm/);
  assert.match(packedRequirement('linux', ['bun', 'npm'])!, /requires npx/);
  assert.equal(packedRequirement('linux'), null); assert.equal(packedRequirement('darwin', ['bun', 'npm', 'npx']), null);
});
