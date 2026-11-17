import assert from 'node:assert/strict';
import test from 'node:test';
import { isBehavioralRevertFailure } from './revert-failure.ts';

test('TAP refusal and assertion diagnostics are behavioral failures', () => {
  const refusal = [
    'not ok 1 - comparison refuses dimensions kinds subjects populations digests and windows',
    '  ---',
    "  failureType: 'testCodeFailure'",
    "  error: 'Unit dimensions differ'",
    "  code: 'dimension_mismatch'",
    "  name: 'UnitRefusal'",
    '  ...',
  ].join('\n');
  const assertion = [
    'not ok 1 - rational properties and all exact conversions use an independent integer oracle',
    '  ---',
    "  failureType: 'testCodeFailure'",
    "  code: 'ERR_ASSERTION'",
    "  name: 'AssertionError'",
    '  ...',
  ].join('\n');
  assert.equal(isBehavioralRevertFailure(refusal), true);
  assert.equal(isBehavioralRevertFailure(assertion), true);
});

test('syntax and module load failures are rejected even when logged text names a refusal or assertion', () => {
  for (const error of ['SyntaxError: Expression expected', 'Error [ERR_MODULE_NOT_FOUND]: Cannot find module']) {
    const output = [
      '# ' + error,
      "#   name: 'UnitRefusal'",
      "#   code: 'ERR_ASSERTION'",
      'not ok 1 - test/broken.test.ts',
      '  ---',
      "  failureType: 'testCodeFailure'",
      "  error: 'test failed'",
      "  code: 'ERR_TEST_FAILURE'",
      '  ...',
    ].join('\n');
    assert.equal(isBehavioralRevertFailure(output), false);
  }
  assert.equal(isBehavioralRevertFailure(''), false);
});
