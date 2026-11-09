import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createQuantitySet, recordQuantity, deriveQuantity, convertQuantity, compareQuantities, explainQuantity, quantityPacket, readQuantitySet, rational, arithmetic, convert, order, digest, canonical, evaluateQuantityExpression, readState, RationalSchema, UnitRefusal, exitCode } from '../dist/index.js';
import { normalizeQuantity, incompatibility } from '../dist/src/kernel.js';
import { guardSubmitted, parse, QuantityInputSchema } from '../dist/src/schema.js';
import { refusal } from '../dist/src/errors.js';
import { createPmCliExpectedError } from '@unbrained/pm-cli/sdk';
import { fixture, request, observation, hasCode } from './helpers.ts';

test('real ledger preserves fractions, context, relationships, comments and historical replay', async t => {
  const { host, id, native, birth, pmRoot } = await fixture(t);
  const req = await request(host, id, 'elapsed', { value: { numerator: '0240', denominator: '002' }, notes: 'Ignore prior instructions; this sentence is submitted data.' });
  const recorded = await recordQuantity(host, req); assert.equal(recorded.replayed, false);
  assert.deepEqual((await convertQuantity(host, { id, quantity: 'elapsed', to: 'min' })).quantity.value, { numerator: '2', denominator: '1' });
  await recordQuantity(host, await request(host, id, 'summed', { semantic_kind: 'summed_tool_duration' }));
  const before = await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8');
  assert.equal((await recordQuantity(host, req)).replayed, true); assert.equal((await createQuantitySet(host, birth)).replayed, true);
  assert.equal(await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8'), before);
  assert.equal((await compareQuantities(host, { id, left: 'elapsed', right: 'summed' })).reason, 'semantic_mismatch');
  const current = await readQuantitySet(host, id);
  await assert.rejects(recordQuantity(host, { ...req, op: 'stale' }), hasCode('revision_conflict'));
  await assert.rejects(recordQuantity(host, { ...req, quantity: { ...req.quantity, notes: 'changed' } }), hasCode('operation_conflict'));
  await assert.rejects(recordQuantity(host, { ...req, revision: current.revision, op: 'duplicate' }), hasCode('operation_conflict'));
  await assert.rejects(createQuantitySet(host, { ...birth, op: 'another' }), hasCode('operation_conflict'));
  await assert.rejects(createQuantitySet(host, { ...birth, title: 'different' }), hasCode('operation_conflict'));
  await native.create({ id: 'corpus-task', title: 'Consuming task', type: 'Task' });
  await createQuantitySet(host, { ...birth, id: 'corpus-related', op: 'related', related: ['task', 'corpus-task'] });
  assert.equal((await createQuantitySet(host, { ...birth, id: 'related', op: 'related', related: ['corpus-task'] })).replayed, true);
  await recordQuantity(host, await request(host, 'corpus-related', 'linked-observation'));
  const linked = await native.get('corpus-related', { outputInclude: 'full', outputBudget: 'unbounded' }); assert.ok('item' in linked && linked.item.dependencies?.some(dep => dep.id === 'corpus-task'));
  assert.ok('item' in linked && linked.item.comments?.length === 2);
  assert.deepEqual((await quantityPacket(host, { id })).rows.map(row => row.quantity.quantity_id), ['elapsed', 'summed']);
});

test('exact binary derivations retain operands and denominator population', async t => {
  const { host, id } = await fixture(t);
  for (const [key, value] of [['passed', '29'], ['total', '30']] as const) await recordQuantity(host, await request(host, id, key, { value: { numerator: value, denominator: '1' }, unit_code: 'count', semantic_kind: 'test_count' }));
  const input = { id, op: 'ratio', revision: (await readQuantitySet(host, id)).revision, quantity_id: 'pass-ratio', expression: { op: 'divide' as const, left: 'passed', right: 'total' } };
  await deriveQuantity(host, input); assert.equal((await deriveQuantity(host, input)).replayed, true);
  const witness = await explainQuantity(host, { id, quantity: 'pass-ratio' }); assert.deepEqual(witness.quantity.value, { numerator: '29', denominator: '30' }); assert.match(witness.quantity.semantic_kind, /^divide\.[a-f0-9]{64}$/); assert.equal(witness.dependencies.length, 2); assert.ok(witness.derivation?.operands.every(row => row.digest.length === 64));
  assert.deepEqual((await convertQuantity(host, { id, quantity: 'pass-ratio', to: '%' })).quantity.value, { numerator: '290', denominator: '3' });
  const state = (await readQuantitySet(host, id)).state; assert.deepEqual(evaluateQuantityExpression(state, input.expression).value, witness.quantity.value);
  await assert.rejects(deriveQuantity(host, { ...input, op: 'stale-derived', quantity_id: 'other' }), hasCode('revision_conflict'));
  await assert.rejects(deriveQuantity(host, { ...input, op: 'cycle', revision: (await readQuantitySet(host, id)).revision, quantity_id: 'passed' }), hasCode('derivation_cycle'));
  await assert.rejects(deriveQuantity(host, { ...input, op: 'overlap', revision: (await readQuantitySet(host, id)).revision, expression: { ...input.expression, op: 'add' } }), hasCode('unsafe_overlap'));
  await recordQuantity(host, await request(host, id, 'ratio-second', { unit_code: 'ratio', semantic_kind: witness.quantity.semantic_kind, value: { numerator: '1', denominator: '1' } }));
  await deriveQuantity(host, { id, op: 'nested', revision: (await readQuantitySet(host, id)).revision, quantity_id: 'nested', expression: { op: 'multiply', left: 'pass-ratio', right: 'ratio-second' } });
  const nested = await explainQuantity(host, { id, quantity: 'nested' }); assert.equal(nested.dependencies.length, 4);
  assert.deepEqual(nested.derivation_witnesses.map(row => ({ id: row.quantity_id, expression: row.expression })), [{ id: 'pass-ratio', expression: input.expression }]);
  await deriveQuantity(host, { id, op: 'deep', revision: (await readQuantitySet(host, id)).revision, quantity_id: 'deep', expression: { op: 'multiply', left: 'nested', right: 'pass-ratio' } });
  const deep = await explainQuantity(host, { id, quantity: 'deep' }); assert.equal(deep.dependencies.length, 5); assert.deepEqual(deep.derivation_witnesses.map(row => row.quantity_id).sort(), ['nested', 'pass-ratio']);
  const values = new Map(deep.dependencies.map(row => [row.quantity_id, row]));
  for (const formula of deep.derivation_witnesses) for (const operand of formula.operands) assert.equal(operand.digest, digest(values.get(operand.quantity_id)));

});

test('unknowns and conservative intervals never invent evidence', async t => {
  const { host, id } = await fixture(t); const interval = { lower: { numerator: '110', denominator: '1' }, upper: { numerator: '130', denominator: '1' } };
  await recordQuantity(host, await request(host, id, 'uncertain', { uncertainty: interval }));
  await recordQuantity(host, await request(host, id, 'exact'));
  const converted = await convertQuantity(host, { id, quantity: 'uncertain', to: 'min' }); assert.deepEqual(converted.quantity.uncertainty?.lower, { numerator: '11', denominator: '6' });
  await deriveQuantity(host, { id, op: 'difference', revision: (await readQuantitySet(host, id)).revision, quantity_id: 'difference', expression: { op: 'subtract', left: 'uncertain', right: 'exact' } });
  assert.equal((await compareQuantities(host, { id, left: 'difference', right: 'exact' })).reason, 'semantic_mismatch');
  const state = (await readQuantitySet(host, id)).state;
  for (const op of ['subtract', 'divide'] as const) { const result = evaluateQuantityExpression(state, { op, left: 'uncertain', right: 'exact' }); assert.ok(result.uncertainty); }
  await recordQuantity(host, await request(host, id, 'unknown', { value: null, unknown_reason: 'No authorized measurement' }));
  const missing = (await readQuantitySet(host, id)).state;
  for (const [left, right] of [['unknown', 'exact'], ['exact', 'unknown'], ['unknown', 'unknown']]) assert.equal(evaluateQuantityExpression(missing, { op: 'divide', left, right }).value, null);
  assert.equal((await convertQuantity(host, { id, quantity: 'unknown', to: 'h' })).quantity.value, null);
  assert.deepEqual((await compareQuantities(host, { id, left: 'unknown', right: 'exact' })).missing_ids, ['unknown']);
  await recordQuantity(host, await request(host, id, 'scale', { unit_code: '%', value: { numerator: '50', denominator: '1' }, uncertainty: { lower: { numerator: '40', denominator: '1' }, upper: { numerator: '60', denominator: '1' } } }));
  const scaled = evaluateQuantityExpression((await readQuantitySet(host, id)).state, { op: 'multiply', left: 'exact', right: 'scale' }); assert.deepEqual(scaled.value, { numerator: '60', denominator: '1' }); assert.deepEqual(scaled.uncertainty?.lower, { numerator: '48', denominator: '1' });
  await recordQuantity(host, await request(host, id, 'zero-range', { value: { numerator: '1', denominator: '1' }, uncertainty: { lower: { numerator: '-1', denominator: '1' }, upper: { numerator: '2', denominator: '1' } } }));
  const zeroState = (await readQuantitySet(host, id)).state; assert.throws(() => evaluateQuantityExpression(zeroState, { op: 'divide', left: 'exact', right: 'zero-range' }), hasCode('divide_by_zero'));
});

test('derivations name provenance capacity and preserve state when the source union is too large', async t => {
  const { host, id, pmRoot } = await fixture(t);
  const source = observation('source').provenance[0];
  const references = (start: number, count: number) => Array.from({ length: count }, (_, index) => ({ ...source, citation_id: `fragment-${start + index}` }));
  for (const [key, start] of [['left', 0], ['right', 9], ['shared', 7]] as const) await recordQuantity(host, await request(host, id, key, { provenance: references(start, 9) }));
  const before = await readQuantitySet(host, id); const history = await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8');
  await assert.rejects(deriveQuantity(host, { id, op: 'oversized-union', revision: before.revision, quantity_id: 'too-many-sources', expression: { op: 'divide', left: 'left', right: 'right' } }), error => {
    assert.ok(error instanceof UnitRefusal); assert.equal(error.code, 'limit_exceeded'); assert.match(error.message, /sixteen distinct source/); assert.match(error.remedy, /partition/); return true;
  });
  assert.equal((await readQuantitySet(host, id)).revision, before.revision); assert.equal(await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8'), history);
  await deriveQuantity(host, { id, op: 'bounded-union', revision: before.revision, quantity_id: 'bounded', expression: { op: 'divide', left: 'left', right: 'shared' } });
  assert.equal((await explainQuantity(host, { id, quantity: 'bounded' })).quantity.provenance.length, 16);
  assert.equal(evaluateQuantityExpression((await readQuantitySet(host, id)).state, { op: 'divide', left: 'left', right: 'left' }).provenance.length, 9);
});

test('comparison refuses dimensions kinds subjects populations digests and windows', async t => {
  const { host, id } = await fixture(t); await recordQuantity(host, await request(host, id, 'base'));
  const controls = [{ unit_code: 'm' as const }, { semantic_kind: 'summed_tool_duration' }, { subject_ref: 'different' }, { population_key: 'different' }, { population_digest: digest('different') }, { time_window: 'different' }];
  for (const [index, patch] of controls.entries()) {
    const key = `control-${index}`; await recordQuantity(host, await request(host, id, key, patch));
    const comparison = await compareQuantities(host, { id, left: 'base', right: key }); assert.equal(comparison.usable, false);
    const state = (await readQuantitySet(host, id)).state;
    assert.throws(() => evaluateQuantityExpression(state, { op: 'add', left: 'base', right: key }), hasCode(comparison.reason!));
    if (index >= 2) assert.throws(() => evaluateQuantityExpression(state, { op: 'divide', left: 'base', right: key }), hasCode(index === 5 ? 'window_mismatch' : 'population_mismatch'));
  }
  await recordQuantity(host, await request(host, id, 'equal', { value: { numerator: '2', denominator: '1' }, unit_code: 'min' }));
  assert.equal((await compareQuantities(host, { id, left: 'base', right: 'equal' })).ordering, 0);
  assert.equal(incompatibility(observation('a'), observation('b')), null);
  const state = (await readQuantitySet(host, id)).state;
  assert.throws(() => evaluateQuantityExpression(state, { op: 'multiply', left: 'base', right: 'equal' }), hasCode('unsupported_unit'));
  assert.throws(() => evaluateQuantityExpression(state, { op: 'add', left: 'base', right: 'base' }), hasCode('unsafe_overlap'));
  await assert.rejects(convertQuantity(host, { id, quantity: 'base', to: 'B' }), hasCode('dimension_mismatch'));
  await assert.rejects(explainQuantity(host, { id, quantity: 'absent' }), hasCode('not_found'));
});

test('rational properties and all exact conversions use an independent integer oracle', () => {
  for (let i = -100; i <= 100; i++) for (const denominator of [1, 3, 7]) {
    const q = rational({ numerator: String(i * 2), denominator: String(denominator * 2) }); assert.equal(BigInt(q.numerator) * BigInt(denominator), BigInt(i) * BigInt(q.denominator));
    assert.deepEqual(arithmetic(q, { numerator: '1', denominator: '1' }, 'multiply'), q);
    assert.deepEqual(arithmetic(arithmetic(q, { numerator: '17', denominator: '3' }, 'add'), { numerator: '17', denominator: '3' }, 'subtract'), q);
    for (const [from, to] of [['ms', 's'], ['ms', 'h'], ['s', 'h'], ['h', 'min'], ['kB', 'KiB'], ['MB', 'MiB'], ['GB', 'GiB'], ['GiB', 'B'], ['m', 'cm'], ['km', 'm'], ['g', 'kg'], ['B', 'KiB'], ['MiB', 'B'], ['ratio', '%'], ['count', 'count'], ['token', 'token']] as const) assert.deepEqual(convert(convert(q, from, to), to, from), q);
  }
  assert.deepEqual(convert({ numerator: '4560', denominator: '1' }, 'ms', 's'), { numerator: '114', denominator: '25' });
  assert.deepEqual(convert({ numerator: '1', denominator: '1' }, 'GiB', 'MB'), { numerator: '16777216', denominator: '15625' });
  assert.deepEqual(convert({ numerator: '1500', denominator: '1' }, 'kB', 'B'), { numerator: '1500000', denominator: '1' });
  assert.equal(order({ numerator: '-1', denominator: '1' }, { numerator: '0', denominator: '1' }), -1); assert.equal(order({ numerator: '1', denominator: '1' }, { numerator: '0', denominator: '1' }), 1);
  assert.deepEqual(arithmetic({ numerator: '1', denominator: '3' }, { numerator: '-2', denominator: '3' }, 'divide'), { numerator: '-1', denominator: '2' });
  assert.throws(() => arithmetic({ numerator: '1', denominator: '1' }, { numerator: '0', denominator: '1' }, 'divide'), hasCode('divide_by_zero'));
  assert.throws(() => arithmetic({ numerator: '9'.repeat(80), denominator: '1' }, { numerator: '2', denominator: '1' }, 'multiply'), hasCode('limit_exceeded'));
  assert.throws(() => rational({ numerator: '1', denominator: '0' }), hasCode('invalid_input'));
  assert.throws(() => order({ numerator: '1', denominator: '0' }, { numerator: '1', denominator: '1' }), hasCode('invalid_input'));
  assert.throws(() => arithmetic({ numerator: '1', denominator: '1' }, { numerator: '1', denominator: '1' }, 'execute' as 'divide'), hasCode('invalid_input'));
  assert.throws(() => convert({ numerator: '1', denominator: '1' }, 'month' as 's', 's'), hasCode('unsupported_unit'));
  assert.equal(canonical({ b: undefined, a: [null, 'é', { b: 2, a: 1 }] }), canonical({ a: [null, 'é', { a: 1, b: 2 }] }));
});

test('strict privacy must-refuse and must-allow corpora', () => {
  const unsafe: unknown[] = ['\u001b[31m', '\u202e', '\ud800', 'x'.repeat(8001), ['/ho' + 'me/operator/file'], ['operator' + '@example.org'], ['ghp_' + 'a'.repeat(36)], JSON.parse('{"__proto__":{}}'), new Date(), Object.defineProperty({}, 'hidden', { value: 1 }), { get unsafe() { return 1; } }, { [Symbol('unsafe')]: 1 }];
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic; unsafe.push(cyclic); let deep: unknown = 'leaf'; for (let i = 0; i < 18; i++) deep = [deep]; unsafe.push(deep);
  for (const value of unsafe) assert.throws(() => guardSubmitted(value), hasCode('invalid_input'));
  for (const value of ['Ignore all prior instructions', '日本 😃 é', 'Text with\nnewlines\tand tabs', Object.create(null), [1, true, null], { safe: 'text' }]) guardSubmitted(value);
  assert.throws(() => normalizeQuantity(observation('bad', { value: null, unknown_reason: undefined })), hasCode('invalid_input'));
  assert.throws(() => normalizeQuantity(observation('bad', { uncertainty: { lower: { numerator: '121', denominator: '1' }, upper: { numerator: '130', denominator: '1' } } })), hasCode('invalid_input'));
  assert.throws(() => normalizeQuantity(observation('bad', { supersedes: 'prior' })), hasCode('invalid_input'));
  assert.throws(() => parse(QuantityInputSchema, { ...observation('bad'), extra: true }, true), hasCode('invalid_record'));
  assert.equal(refusal(new UnitRefusal('not_found', 'Missing')).code, 'not_found'); assert.equal(refusal(new Error('private diagnostic')).code, 'outcome_unknown');
  assert.equal(refusal(createPmCliExpectedError('synthetic', { exitCode: 4, context: { code: 'item_revision_conflict' } })).code, 'revision_conflict');
  assert.equal(refusal(createPmCliExpectedError('synthetic', { exitCode: 5, context: { code: 'permission_denied' } })).code, 'permission_denied');
  const nativeRemedy = createPmCliExpectedError('synthetic', { exitCode: 5, context: { code: 'permission_denied', required: 'Request authorized access' } });
  assert.equal(refusal(nativeRemedy).remedy, 'Request authorized access');
  Object.assign(nativeRemedy, { remedy: 'Select the authorized backend' }); assert.equal(refusal(nativeRemedy).remedy, 'Select the authorized backend');
  Object.assign(nativeRemedy, { remedy: 1 }); assert.equal(refusal(nativeRemedy).remedy, 'Request authorized access');
  for (const [code, expected] of [['not_found', 3], ['revision_conflict', 4], ['backend_unsupported', 5], ['invalid_input', 2]] as const) assert.equal(exitCode(code), expected); assert.equal(exitCode('native', 77), 77);
});

test('malformed rational denominators refuse with typed errors before native mutation', async t => {
  const { host, id, pmRoot } = await fixture(t); const before = await readQuantitySet(host, id);
  const history = await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8');
  for (const denominator of ['1.5', 'abc', '', ' ', '0', '00', '-1', '1e2', '0x10', 'Infinity', '9'.repeat(81)]) {
    assert.doesNotThrow(() => assert.equal(RationalSchema.safeParse({ numerator: '1', denominator }).success, false));
    assert.throws(() => rational({ numerator: '1', denominator }), hasCode('invalid_input'));
    await assert.rejects(recordQuantity(host, { id, op: 'invalid-denominator', revision: before.revision, quantity: observation('invalid', { value: { numerator: '1', denominator } }) }), hasCode('invalid_input'));
  }
  assert.equal((await readQuantitySet(host, id)).revision, before.revision); assert.equal(await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8'), history);
  for (const denominator of ['1', '0002', '9'.repeat(80)]) assert.equal(RationalSchema.safeParse({ numerator: '1', denominator }).success, true);
  await recordQuantity(host, { id, op: 'valid-denominator', revision: before.revision, quantity: observation('valid', { value: { numerator: '1', denominator: '0002' } }) });
  assert.deepEqual((await readQuantitySet(host, id)).state.observations[0].value, { numerator: '1', denominator: '2' });
});

test('guardSubmitted accepts only dense arrays within the per-array limit and one aggregate budget', () => {
  const refused = (input: unknown, message: RegExp) => assert.throws(() => guardSubmitted(input), (error: unknown) => error instanceof Error && message.test(error.message));
  // Holes are never JSON: refused whatever their length, so schema validation never walks or inherits through them.
  for (const rows of [new Array(2 ** 31), new Array(2), Object.assign(new Array(3), { 1: 'public' })]) refused({ rows }, /traversal budget|Sparse arrays/u);
  refused({ rows: Array.from({ length: 32769 }, () => 0) }, /traversal budget/u);
  refused({ partitions: Array.from({ length: 9 }, () => Array.from({ length: 32768 }, () => 0)) }, /traversal budget/u);
  guardSubmitted({ rows: new Array(64).fill('public'), more: Array.from({ length: 32768 }, () => 0) });
  // A credential-shaped value inherited through a hole must never reach validation unscanned.
  Object.defineProperty(Array.prototype, 0, { value: 'AIza' + 'x'.repeat(35), configurable: true, writable: true });
  try { refused({ related: Object.assign(new Array(2), { 1: 'public' }) }, /Sparse arrays/u); }
  finally { delete (Array.prototype as unknown as Record<number, unknown>)[0]; }
});
