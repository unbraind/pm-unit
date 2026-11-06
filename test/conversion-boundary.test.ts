import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { convert, rational, UnitRefusal, recordQuantity, readQuantitySet, convertQuantity, compareQuantities, deriveQuantity } from '../dist/index.js';
import type { Rational, UnitCode } from '../dist/index.js';
import { fixture, request, hasCode } from './helpers.ts';

// Independent physical scales; never read the implementation's unit dictionary.
const dimensions: [UnitCode, bigint, bigint][][] = [
  [['ms', 1n, 1000n], ['s', 1n, 1n], ['min', 60n, 1n], ['h', 3600n, 1n]],
  [['m', 1n, 1n], ['cm', 1n, 100n], ['km', 1000n, 1n]],
  [['g', 1n, 1n], ['kg', 1000n, 1n]],
  [['B', 1n, 1n], ['kB', 1000n, 1n], ['MB', 1000000n, 1n], ['GB', 1000000000n, 1n], ['KiB', 1024n, 1n], ['MiB', 1048576n, 1n], ['GiB', 1073741824n, 1n]],
  [['count', 1n, 1n]], [['token', 1n, 1n]], [['ratio', 1n, 1n], ['%', 1n, 100n]],
];

/** Independent unbounded Euclidean reduction for the complete expected result. */
function exact(n: bigint, d: bigint): Rational {
  let a = n < 0n ? -n : n; let b = d;
  while (b) [a, b] = [b, a % b];
  return { numerator: String(n / a), denominator: String(d / a) };
}

/** Seeded samples on both sides of the precision boundary, including cancellable scales. */
function boundaryValues(): Rational[] {
  const values: Rational[] = [{ numerator: '-000', denominator: '0002' }];
  let seed = 0x6c0ffee;
  for (const digits of [69, 70, 71, 76, 77, 78, 79, 80]) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const power = 10n ** BigInt(digits - 1);
    for (const component of [power, power + BigInt(seed), 10n * power - 1n]) {
      for (const sign of [1n, -1n]) {
        values.push(exact(sign * component, 1n), exact(sign, component), exact(sign * component, component - 1n));
      }
    }
  }
  return values;
}

test('boundary identity conversions preserve normalized admitted components in every unit', () => {
  for (const [unit] of dimensions.flat()) for (const value of boundaryValues()) {
    assert.deepEqual(convert(value, unit, unit), rational(value), `${unit}: ${JSON.stringify(value)}`);
  }
});

test('boundary compatible conversions agree with the complete exact result or typed final limit', t => {
  let admitted = 0; let refused = 0;
  for (const dimension of dimensions) for (const [from, fn, fd] of dimension) for (const [to, tn, td] of dimension) {
    if (from === to) continue;
    for (const value of boundaryValues()) {
      const expected = exact(BigInt(value.numerator) * fn * td, BigInt(value.denominator) * fd * tn);
      const label = `${from}->${to}: ${JSON.stringify(value)}`;
      if (expected.numerator.replace('-', '').length <= 80 && expected.denominator.length <= 80) {
        assert.deepEqual(convert(value, from, to), expected, label);
        assert.deepEqual(convert(expected, to, from), rational(value), label); admitted++;
      } else {
        assert.throws(() => convert(value, from, to), error => error instanceof UnitRefusal && error.code === 'limit_exceeded', label); refused++;
      }
    }
  }
  assert.ok(admitted > 0 && refused > 0); t.diagnostic(JSON.stringify({ admitted, refused }));
});

test('boundary SDK conversions and self comparisons preserve persisted quantities and audit history', async t => {
  const { host, id, pmRoot } = await fixture(t);
  const large = `1${'0'.repeat(79)}`;
  const cases: [UnitCode, UnitCode, Rational][] = [
    ['GB', 'GiB', { numerator: large, denominator: '1' }],
    ['h', 'min', { numerator: '1', denominator: large }],
    ['ms', 's', { numerator: '1', denominator: large }],
    ['%', 'ratio', { numerator: '1', denominator: large }],
  ];
  for (const [index, [unit_code, , value]] of cases.entries()) {
    await recordQuantity(host, await request(host, id, `boundary-${index}`, { unit_code, value }));
  }
  const before = await readQuantitySet(host, id); const path = join(pmRoot, 'history', `${id}.jsonl`); const history = await readFile(path, 'utf8');
  for (const [index, [unit, to, value]] of cases.entries()) {
    const quantity = `boundary-${index}`;
    assert.deepEqual((await convertQuantity(host, { id, quantity, to: unit })).quantity.value, value);
    const comparison = await compareQuantities(host, { id, left: quantity, right: quantity });
    assert.equal(comparison.usable, true); assert.equal(comparison.ordering, 0);
    const [, fn, fd] = dimensions.flat().find(([code]) => code === unit)!;
    const [, tn, td] = dimensions.flat().find(([code]) => code === to)!;
    const expected = exact(BigInt(value.numerator) * fn * td, BigInt(value.denominator) * fd * tn);
    if (index < 2) assert.deepEqual((await convertQuantity(host, { id, quantity, to })).quantity.value, expected);
    else await assert.rejects(convertQuantity(host, { id, quantity, to }), hasCode('limit_exceeded'));
  }
  assert.deepEqual(await readQuantitySet(host, id), before); assert.equal(await readFile(path, 'utf8'), history);

  const target = exact(BigInt(large) * 1000000000n, 1073741824n);
  await recordQuantity(host, await request(host, id, 'binary-equivalent', { unit_code: 'GiB', value: target }));
  assert.equal((await compareQuantities(host, { id, left: 'binary-equivalent', right: 'boundary-0' })).ordering, 0);
  await deriveQuantity(host, { id, op: 'boundary-subtract', revision: (await readQuantitySet(host, id)).revision, quantity_id: 'difference', expression: { op: 'subtract', left: 'binary-equivalent', right: 'boundary-0' } });
  assert.deepEqual((await readQuantitySet(host, id)).state.derivations[0].quantity.value, { numerator: '0', denominator: '1' });

  const upper = { numerator: String(2n * BigInt(large)), denominator: '1' };
  await recordQuantity(host, await request(host, id, 'uncertain-boundary', { unit_code: 'GB', value: cases[0][2], uncertainty: { lower: cases[0][2], upper } }));
  assert.deepEqual((await convertQuantity(host, { id, quantity: 'uncertain-boundary', to: 'GiB' })).quantity.uncertainty, { lower: target, upper: exact(BigInt(upper.numerator) * 1000000000n, 1073741824n) });
});
