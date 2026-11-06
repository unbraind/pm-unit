import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { corpusRoot, isEarthFactSource, matchClaims, harvestReviewLine, decimalFraction, conversionFactor } from './corpus.ts';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';

test('decimal claims validate the complete input before BigInt and retain exact fixture fractions', () => {
  for (const [text, numerator, denominator] of [['0', '0', '1'], ['00012', '12', '1'], ['001.020', '1020', '1000'], ['0.0001', '1', '10000']]) assert.deepEqual(decimalFraction(text, 'valid-claim'), { numerator, denominator });
  const fixture = JSON.parse(readFileSync(join(corpusRoot, 'test/fixtures/measurements.json'), 'utf8')) as { claims: { key: string; decimal: string; scale: string; divisor: string }[] };
  for (const claim of fixture.claims) { assert.doesNotThrow(() => decimalFraction(claim.decimal, claim.key)); assert.doesNotThrow(() => conversionFactor(claim.scale, claim.key)); assert.doesNotThrow(() => conversionFactor(claim.divisor, claim.key)); }
  for (const value of [undefined, null, 1, {}, []]) {
    assert.throws(() => decimalFraction(value as string, 'wrong-type'), /Invalid decimal claim "wrong-type"/);
    assert.throws(() => conversionFactor(value as string, 'wrong-type'), /Invalid conversion factor for "wrong-type"/);
  }
  for (const [text, expected] of [['1', 1n], ['001', 1n], ['1048576', 1048576n]] as const) assert.equal(conversionFactor(text, 'valid-factor'), expected);
  for (const text of ['', '0', '00', '1.5', '-1', '+1', '1e2', '1\n', ' 1', 'text']) assert.throws(() => conversionFactor(text, 'broken-factor'), error => {
    assert.ok(error instanceof assert.AssertionError); assert.match(error.message, /Invalid conversion factor for "broken-factor"/); return true;
  });
  for (const text of ['', ' ', '1.', '.1', '1.2.3', '+1', '-1', '1e2', '0x10', 'NaN', 'Infinity', '1\n', '1\r\n', '1\t', ' 1', '1 ']) assert.throws(() => decimalFraction(text, 'broken-claim'), error => {
    assert.ok(error instanceof assert.AssertionError); assert.match(error.message, /Invalid decimal claim "broken-claim"/); return true;
  });
});

test('physical source classification parses the exact host instead of URL substrings', () => {
  for (const source of ['https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html', 'https://NSSDC.GSFC.NASA.GOV/facts']) assert.equal(isEarthFactSource(source), true);
  for (const source of ['https://example.org/nasa.gov', 'https://example.org/?host=nasa.gov', 'https://nssdc.gsfc.nasa.gov.example.org/facts', 'https://nssdc.gsfc.nasa.gov@example.org/facts', 'https://other.nasa.gov/facts', 'not a URL']) assert.equal(isEarthFactSource(source), false);
});

test('paired claims preserve each rule kind and carry explicit source-match roles', () => {
  const base = { reported_at: '2026-11-06T00:00:00Z', unit: '%' as const, to: 'ratio' as const, scale: '1', divisor: '100', kind: 'coverage_percentage', population: 'public-pair', source_kind: 'native_item' as const, item_id: 'public-source', item_hash: 'a'.repeat(64), pointer: '/comments/0/text', fragment_digest: 'b'.repeat(64), source: 'https://github.com/example/public' };
  const pair = matchClaims(base, ['90', '95'], 7);
  assert.deepEqual(pair.map(row => row.kind), ['coverage_percentage', 'coverage_percentage']);
  assert.deepEqual(pair.map(row => [row.key, row.pair_of, row.pair_role]), [['fleet-7', 'public-pair', 'numerator'], ['fleet-8', 'public-pair', 'denominator']]);
  assert.equal(matchClaims(base, ['90'], 9)[0].pair_of, undefined);
  const fragment = `${'prefix '.repeat(40)}90/95 percent\n\u001b[31m${'suffix '.repeat(40)}`; const offset = fragment.indexOf('90/95');
  const line = harvestReviewLine(pair[0], fragment, offset); assert.ok(!line.includes('\u001b')); assert.ok(!line.includes('\n'));
  const review = JSON.parse(line) as { selected_claim: unknown; match_offset: number; excerpt: string };
  assert.deepEqual(review.selected_claim, pair[0]); assert.equal(review.match_offset, offset); assert.match(review.excerpt, /90\/95 percent/); assert.ok(review.excerpt.length <= 200);
});

test('corpus acceptance uses checkout paths from a foreign cwd and derives nonadjacent source pairs', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'unit-corpus-location-'));
  try {
    const checkout = join(scratch, 'checkout'); const foreign = join(scratch, 'caller');
    mkdirSync(foreign);
    for (const path of ['test', 'dist', 'src', 'scripts', 'docs', 'package.json']) cpSync(join(corpusRoot, path), join(checkout, path), { recursive: true });
    symlinkSync(join(corpusRoot, 'node_modules'), join(checkout, 'node_modules'), 'dir');
    const fixturePath = join(checkout, 'test/fixtures/measurements.json');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { claims: { pair_role?: string }[] };
    const rank = (role?: string) => role === 'numerator' ? 0 : role === 'denominator' ? 2 : 1;
    fixture.claims.sort((left, right) => rank(left.pair_role) - rank(right.pair_role)); writeFileSync(fixturePath, JSON.stringify(fixture));
    const result = spawnSync(process.execPath, [join(checkout, 'test/real-data.acceptance.ts'), '--write-receipt'], { cwd: foreign, env: { ...testEnvironment(npmEnvironment(process.env)), GIT_CEILING_DIRECTORIES: scratch }, encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(readFileSync(join(checkout, 'real-data.local.json'), 'utf8')) as { reproduced: number; derived_ratios: number; refusals: unknown[] };
    assert.equal(report.reproduced, 47); assert.equal(report.derived_ratios, 1); assert.equal(report.refusals.length, 6);
    assert.deepEqual(JSON.parse(readFileSync(join(checkout, 'docs/real-data-receipt.json'), 'utf8')), report);
    assert.equal(existsSync(join(foreign, 'real-data.local.json')), false);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
