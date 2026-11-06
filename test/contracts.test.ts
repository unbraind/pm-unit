import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionTestHarness, decodeToon } from '@unbrained/pm-cli/sdk/testing';
import { fitOutputEnvelope, createPmCliExpectedError, OutputEnvelopeFitError } from '@unbrained/pm-cli/sdk';
import { PmClient } from '@unbrained/pm-cli/sdk/core';
import extension, { createQuantitySet, recordQuantity, deriveQuantity, readQuantitySet, readState, quantityPacket, createDirectoryHost, digest, envelope, fitEnvelope, UnitRefusal } from '../dist/index.js';
import { runCommand, inputJson } from '../dist/src/commands.js';
import { refusalEnvelope, wire } from '../dist/src/output.js';
import { persistedSchemaPort } from '../dist/src/host.js';
import type { UnitResult } from '../dist/index.js';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import { fixture, request, observation, hasCode } from './helpers.ts';

test('native harness executes all commands and round-trips scoped JSON and TOON renderers', async t => {
  const { pmRoot, native } = await fixture(t); const ext = await createExtensionTestHarness(extension, { capabilities: ['commands', 'schema', 'renderers'] }); t.after(() => ext.deactivate());
  for (const name of ['create', 'record', 'derive', 'convert', 'compare', 'explain', 'packet']) ext.assertCommandContract({ command: `unit ${name}` });
  ext.assertItemField({ name: 'unit_state', type: 'object' }); ext.assertItemType({ name: 'QuantitySet', folder: 'quantities' });
  /** Exercise the real extension host and assert portable envelope metadata. */
  const run = async (command: string, args: string[] = [], options: Record<string, unknown> = {}, global: Record<string, unknown> = {}) => {
    const value = await ext.runCommand({ command: `unit ${command}`, args, options, global, pmRoot }); if (value.cause) throw value.cause;
    assert.equal(value.handled, true); return value.result as UnitResult;
  };
  const birth = await run('create', [], { id: 'corpus-cli', op: 'birth', input: JSON.stringify({ title: 'CLI ledger', quantity_set_key: 'cli' }) }); assert.equal(birth.ok, true);
  const first = await run('record', ['corpus-cli'], { op: 'first', revision: birth.revision, input: JSON.stringify({ quantity: observation('first') }) }); assert.equal(first.ok, true);
  const second = await run('record', ['corpus-cli'], { op: 'second', revision: first.revision, input: JSON.stringify({ quantity: observation('second') }) }); assert.equal(second.ok, true);
  const derived = await run('derive', ['corpus-cli'], { op: 'derive', revision: second.revision, input: JSON.stringify({ quantity_id: 'ratio', expression: { op: 'divide', left: 'first', right: 'second' } }) }); assert.equal(derived.ok, true);
  for (const [command, options] of [['convert', { quantity: 'first', to: 'min' }], ['compare', { left: 'first', right: 'second' }], ['explain', { quantity: 'ratio' }], ['packet', { quantity: 'first' }]] as const) assert.equal((await run(command, ['corpus-cli'], options, { outputBudget: 'unbounded' })).ok, true);
  const result = await run('packet', ['corpus-cli'], { limit: '1' }); assert.ok(result.continuation);
  assert.equal((await run('packet', ['corpus-cli'], { limit: '1' }, { outputCursor: result.continuation })).ok, true);
  assert.equal((await run('packet', ['corpus-cli'], { limit: '1', cursor: result.continuation })).ok, true);
  assert.equal((await run('packet', ['corpus-cli'], { cursor: result.continuation }, { outputCursor: result.continuation })).refusal?.code, 'invalid_input');
  assert.equal((await run('packet', ['corpus-cli'], {}, { outputLimit: '1', outputBudget: '1600' })).ok, true);
  assert.equal((await run('packet', ['corpus-cli'], { budget: '1600', quantity: 'first' })).ok, true);
  assert.equal((await run('packet', ['corpus-cli'], { budget: '1600' }, { outputBudget: '1600' })).refusal?.code, 'invalid_input');
  for (const format of ['json', 'toon'] as const) {
    ext.assertRendererOverride({ format }); const output = await ext.runRendererOverride({ format, command: 'unit packet', result }); const decoded = format === 'json' ? JSON.parse(String(output.rendered)) : decodeToon(String(output.rendered)); assert.deepEqual(decoded, result);
  }
  for (const [command, options, global, expected] of [
    ['record', { op: 'stale', revision: birth.revision, input: JSON.stringify({ quantity: observation('stale') }) }, {}, 'revision_conflict'],
    ['record', { op: 'missing', revision: '', input: '{}' }, {}, 'invalid_input'],
    ['create', { id: 'corpus-refused', op: 'bad', input: '{"id":"other"}' }, {}, 'invalid_input'],
    ['create', { id: 'corpus-refused', op: 'tiny', input: '{"title":"tiny","quantity_set_key":"tiny"}' }, { outputBudget: '1' }, 'output_budget'],
    ['packet', { limit: '1.5' }, {}, 'invalid_input'], ['packet', { limit: '101' }, {}, 'invalid_input'], ['packet', {}, { outputBudget: 0 }, 'invalid_input'], ['packet', {}, { outputBudget: [] }, 'invalid_input'], ['packet', {}, { outputBudget: '1.5' }, 'invalid_input'], ['packet', {}, { outputBudget: '999999999999999999999' }, 'invalid_input'],
    ['packet', { quantity: [] }, {}, 'invalid_input'], ['packet', {}, { outputInclude: 'id' }, 'invalid_input'], ['packet', {}, { outputSession: 'x' }, 'invalid_input'], ['packet', {}, { outputRowContract: 'x' }, 'invalid_input'],
    ['convert', { quantity: 'first', to: 's' }, { outputCursor: 'bad' }, 'invalid_input'], ['convert', { quantity: 'first', to: 's' }, { outputLimit: 1 }, 'invalid_input'],
  ] as const) { const failure = await run(command, ['corpus-cli'], options, global); assert.equal(failure.refusal?.code, expected); assert.equal(failure.ok, false); }
  await assert.rejects(native.get('corpus-refused'), error => error instanceof Error);
  assert.equal((await runCommand('packet', { command: 'unit packet', args: [], options: {}, global: {}, pm_root: pmRoot } as CommandHandlerContext) as UnitResult).refusal?.code, 'backend_unsupported');
});

test('bounded stdin rejects malformed UTF-8, injection and oversized JSON before writes', async () => {
  /** Deterministic byte stream, including malformed UTF-8. */
  async function* stream(bytes: Uint8Array) { yield bytes; }
  assert.deepEqual(await inputJson('-', stream(Buffer.from('{"safe":"é"}'))), { safe: 'é' });
  for (const value of ['{', '[]', 'null', '"text"', 'x'.repeat(32769)]) await assert.rejects(inputJson(value), hasCode('invalid_input'));
  await assert.rejects(inputJson('-', stream(Buffer.from([0xff]))), hasCode('invalid_input'));
  await assert.rejects(inputJson('-', stream(Buffer.concat([Buffer.from('{"safe":"'), Buffer.from([0xff]), Buffer.from('"}')]))), hasCode('invalid_input'));
  await assert.rejects(inputJson('-', stream(Buffer.alloc(32769))), hasCode('invalid_input'));
});

test('packet cursors bind query projection and revision, with complete omission receipts', async t => {
  const { host, id } = await fixture(t); await recordQuantity(host, await request(host, id, 'a')); await recordQuantity(host, await request(host, id, 'b'));
  const first = await quantityPacket(host, { id, limit: 1 }); assert.equal(first.returned, 1); assert.equal(first.omitted, 1); assert.equal(first.total, 2); assert.ok(first.continuation);
  const last = await quantityPacket(host, { id, limit: 1, cursor: first.continuation }); assert.equal(last.continuation, null); assert.equal(last.rows[0].quantity.quantity_id, 'b');
  for (const cursor of ['bad', Buffer.from('null').toString('base64url'), Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ offset: -1, query: 'x', revision: first.revision })).toString('base64url')]) await assert.rejects(quantityPacket(host, { id, limit: 1, cursor }), hasCode('stale_cursor'));
  await assert.rejects(quantityPacket(host, { id, limit: 2, cursor: first.continuation }), hasCode('stale_cursor'));
  const changedOffset = JSON.parse(Buffer.from(first.continuation, 'base64url').toString('utf8')); changedOffset.offset = 100;
  await assert.rejects(quantityPacket(host, { id, limit: 1, cursor: Buffer.from(JSON.stringify(changedOffset)).toString('base64url') }), hasCode('stale_cursor'));
  await recordQuantity(host, await request(host, id, 'c')); await assert.rejects(quantityPacket(host, { id, limit: 1, cursor: first.continuation }), hasCode('stale_cursor'));
  assert.equal((await quantityPacket(host, { id, quantity: 'a' })).rows.length, 1);
});

test('stored records reject future versions corruption out-of-band edits and broken pins', async t => {
  const { host, id } = await fixture(t);
  for (const key of ['a', 'b']) await recordQuantity(host, await request(host, id, key));
  await deriveQuantity(host, { id, op: 'ratio', revision: (await readQuantitySet(host, id)).revision, quantity_id: 'ratio', expression: { op: 'divide', left: 'a', right: 'b' } });
  const state = (await readQuantitySet(host, id)).state;
  for (const [raw, code] of [[null, 'invalid_record'], [{}, 'invalid_record'], [{ version: 2 }, 'unsupported_version'], [{ version: 1, unknown: true }, 'invalid_record']] as const) assert.throws(() => readState(raw), hasCode(code));
  const changes = [
    (copy: typeof state) => { copy.quantity_set_key = 'changed-domain'; },
    (copy: typeof state) => copy.observations.push(copy.observations[0]),
    (copy: typeof state) => copy.operations.push(copy.operations[0]),
    (copy: typeof state) => { copy.observations[0].value!.numerator = '0120'; },
    (copy: typeof state) => { copy.observations[0].notes = 'out of band'; },
    (copy: typeof state) => { copy.observations[0].supersedes = 'a'; copy.observations[0].correction_reason = 'invalid self'; },
    (copy: typeof state) => { copy.derivations[0].declaration_digest = digest('changed'); },
    (copy: typeof state) => { copy.derivations[0].operands[0].digest = digest('changed'); },
    (copy: typeof state) => { copy.derivations[0].operands[0].quantity_id = 'b'; },
    (copy: typeof state) => { copy.operations[0].result_digest = digest('changed'); },
    (copy: typeof state) => { copy.operations[0].result.sequence = 2; },
    (copy: typeof state) => { copy.operations.pop(); },
    (copy: typeof state) => { copy.observations[0].provenance[0].item_hash = 'not-a-hash'; },
    (copy: typeof state) => { copy.observations[0].notes = '\u001b'; },
  ];
  for (const change of changes) { const copy = structuredClone(state); change(copy); assert.throws(() => readState(copy), hasCode('invalid_record')); }
  await recordQuantity(host, await request(host, id, 'correction', { supersedes: 'a', correction_reason: 'Reviewed correction' }));
  await assert.rejects(recordQuantity(host, await request(host, id, 'bad-correction', { supersedes: 'absent', correction_reason: 'not witnessed' })), hasCode('invalid_input'));
  await assert.rejects(readQuantitySet(host, 'corpus-missing'), hasCode('not_found'));
});

test('real native schema collisions and unsupported capabilities fail without adopting peer definitions', async t => {
  const { host, pmRoot, native, birth } = await fixture(t);
  await assert.rejects(readQuantitySet({ ...host, capabilities: { ...host.capabilities, native_item_cas: false } }, birth.id), hasCode('backend_unsupported'));
  await assert.rejects(createQuantitySet({ ...host, capabilities: { ...host.capabilities, create_if_absent: false } }, birth), hasCode('backend_unsupported'));
  await native.create({ id: 'corpus-peer', title: 'Peer task', type: 'Task' }); await assert.rejects(readQuantitySet(host, 'corpus-peer'), hasCode('invalid_record'));
  await assert.rejects(createQuantitySet(host, { ...birth, id: 'corpus-peer' }), hasCode('invalid_record'));
  assert.equal(await host.settings!(), undefined);
  const port = persistedSchemaPort(new PmClient({ pmRoot, noExtensions: true }));
  await port.update(birth.id, { description: 'Peer field preserved' });
  await assert.rejects(port.update(birth.id, { field: ['other=x'] }), hasCode('invalid_input'));
  await assert.rejects(port.update(birth.id, { field: [] }), hasCode('invalid_input'));
  const noOptional = { ...host, normalizeId: undefined, prepareCreate: undefined, fitOutputEnvelope: undefined };
  await createQuantitySet(noOptional, { ...birth, id: 'corpus-plain', op: 'plain', related: ['corpus-peer'] });
  await assert.rejects(createQuantitySet(host, { ...birth, id: 'corpus-new', related: ['corpus-missing'] }), error => error instanceof UnitRefusal);
});

test('whole envelopes preserve witnesses and return verified retry budgets', async t => {
  const { host, id } = await fixture(t); await recordQuantity(host, await request(host, id, 'a'));
  const value = envelope(await quantityPacket(host, { id })); const fitted = fitEnvelope(host, value); assert.ok(fitted.output_fit.estimated_tokens <= 1600);
  assert.throws(() => fitEnvelope(host, value, 0), hasCode('invalid_input'));
  let minimum = 0; try { fitEnvelope({}, value, 1); } catch (error) { assert.ok(error instanceof UnitRefusal); minimum = error.details.minimum_usable_budget as number; }
  assert.ok(minimum > 1); assert.ok(fitEnvelope({}, value, minimum).output_fit.estimated_tokens <= minimum);
  const oversized = { ...value, warnings: ['x'.repeat(40000)] }; assert.throws(() => fitEnvelope(host, oversized, 8192), hasCode('output_budget'));
  assert.equal(refusalEnvelope(new UnitRefusal('not_found', 'Missing')).exit_code, 3);
  assert.deepEqual(JSON.parse(wire(fitted, 'json')), decodeToon(wire(fitted, 'toon')));
  const calls: number[] = []; const observing: typeof fitOutputEnvelope = (rows, options) => { calls.push(options.tokenBudget!); return fitOutputEnvelope(rows, options); };
  fitEnvelope({ fitOutputEnvelope: observing }, value); assert.ok(calls.length > 0);
});
