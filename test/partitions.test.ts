import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionTestHarness, decodeToon } from '@unbrained/pm-cli/sdk/testing';
import extension, { declarePartition, deriveQuantity, readQuantitySet, recordQuantity, readState, digest, canonical, explainQuantity, quantityPacket, envelope, fitEnvelope, evaluateQuantityExpression } from '../dist/index.js';
import type { Quantity, PartitionDeclaration, UnitResult } from '../dist/index.js';
import { hasCode, request, historyEvents, fixture } from './helpers.ts';
import { partitionFixture, partitionRequest, sumRequest } from './partition-helpers.ts';

test('reviewed partition sums exact units and retains immutable evidence through transitive explanations', async t => {
  const { host, id, pmRoot } = await partitionFixture(t, { unit_code: 'min', value: { numerator: '3', denominator: '1' } });
  const legacy = (await readQuantitySet(host, id)).state; const old = canonical(legacy);
  assert.equal(legacy.version, 1); assert.equal(Object.hasOwn(legacy, 'declarations'), false); assert.equal(canonical(readState(legacy)), old);
  const input = await partitionRequest(host, id); const receipt = await declarePartition(host, input);
  assert.equal(receipt.result.kind, 'declare'); assert.equal(receipt.result.digest, digest(input.declaration));
  const owner = await readQuantitySet(host, id); assert.equal(owner.state.version, 2); assert.deepEqual(owner.state.declarations, [input.declaration]);
  assert.deepEqual(owner.state.observations, legacy.observations); assert.deepEqual(owner.state.operations.slice(0, 3), legacy.operations);
  const sum = await sumRequest(host, id);
  await assert.rejects(deriveQuantity(host, { ...sum, expression: { ...sum.expression, declaration_id: 'missing' } }), hasCode('not_found'));
  await deriveQuantity(host, sum);
  const output = await explainQuantity(host, { id, quantity: 'sum' });
  assert.deepEqual(output.quantity.value, { numerator: '300', denominator: '1' }); assert.equal(output.quantity.unit_code, 's');
  assert.equal(output.quantity.population_key, 'union'); assert.equal(output.quantity.population_digest, digest('union'));
  assert.equal(output.derivation?.declaration_digest, digest(input.declaration)); assert.deepEqual(output.declarations, [input.declaration]);
  assert.deepEqual(output.dependencies.map(q => q.quantity_id), ['left', 'right']); assert.ok(output.quantity.provenance.some(p => p.item_id === 'corpus-review'));
  const pure = evaluateQuantityExpression((await readQuantitySet(host, id)).state, sum.expression); assert.deepEqual(pure.value, output.quantity.value);
  const revision = (await readQuantitySet(host, id)).revision;
  await deriveQuantity(host, { id, revision, op: 'delta', quantity_id: 'delta', expression: { op: 'subtract', left: 'sum', right: 'sum' } });
  const transitive = await explainQuantity(host, { id, quantity: 'delta' });
  assert.deepEqual(transitive.declarations, [input.declaration]); assert.equal(transitive.derivation_witnesses.length, 1);
  assert.equal((await quantityPacket(host, { id, quantity: 'delta' })).rows[0].declarations?.length, 1);
  assert.ok(envelope(transitive).source_revisions.some(ref => ref.item_id === 'corpus-review')); assert.doesNotThrow(() => fitEnvelope(host, envelope(transitive), 8192));
  const events = await historyEvents(pmRoot, id);
  const replay = await declarePartition(host, { ...input, id: 'ledger', declaration: { ...input.declaration, reviewed_by: ' reviewer ', rationale: ` ${input.declaration.rationale} ` } });
  assert.equal(replay.replayed, true); assert.deepEqual(replay.result, receipt.result); assert.notEqual(replay.revision, receipt.revision);
  assert.equal(await historyEvents(pmRoot, id), events);
  await assert.rejects(declarePartition(host, { ...input, declaration: { ...input.declaration, rationale: 'Different review' } }), hasCode('operation_conflict'));
  await assert.rejects(declarePartition(host, { ...input, op: 'new-key', revision: replay.revision }), hasCode('operation_conflict'));
  await recordQuantity(host, await request(host, id, 'correction', { supersedes: 'left', correction_reason: 'New observation; old declaration remains pinned.' }));
  assert.equal((await explainQuantity(host, { id, quantity: 'sum' })).derivation?.declaration_digest, digest(input.declaration));
  assert.equal(canonical(readState(legacy)), old);
});

test('partition refusals validate exact pins and context before every side effect', async t => {
  const { host, id, pmRoot } = await partitionFixture(t); const input = await partitionRequest(host, id);
  const invalid: [Partial<PartitionDeclaration>, string][] = [
    [{ operands: [input.declaration.operands[0], input.declaration.operands[0]] }, 'unsafe_overlap'],
    [{ operands: [{ ...input.declaration.operands[0], digest: digest('stale') }, input.declaration.operands[1]] }, 'invalid_input'],
    [{ operands: [{ quantity_id: 'absent', digest: digest('absent') }, input.declaration.operands[1]] }, 'not_found'],
    [{ population_key: 'left' }, 'unsafe_overlap'], [{ population_digest: digest('right') }, 'unsafe_overlap'],
    [{ evidence: [] }, 'invalid_input'], [{ version: 2 } as unknown as Partial<PartitionDeclaration>, 'invalid_input'],
    [{ reviewed_by: '' }, 'invalid_input'], [{ rationale: '  ' }, 'invalid_input'],
    [{ rationale: '\u001b[31m' }, 'invalid_input'],
  ];
  const events = await historyEvents(pmRoot, id);
  for (const [patch, code] of invalid) await assert.rejects(declarePartition(host, { ...input, declaration: { ...input.declaration, ...patch } }), hasCode(code));
  assert.equal((await readQuantitySet(host, id)).revision, input.revision); assert.equal(await historyEvents(pmRoot, id), events);
  await assert.rejects(deriveQuantity(host, await sumRequest(host, id)), hasCode('not_found'));
  await declarePartition(host, input); const sum = await sumRequest(host, id);
  for (const expression of [{ ...sum.expression, op: 'subtract' as const }, { ...sum.expression, left: 'right', right: 'left' }, { ...sum.expression, right: 'left' }]) await assert.rejects(deriveQuantity(host, { ...sum, expression }), hasCode('invalid_input'));
  await assert.rejects(deriveQuantity(host, { ...sum, expression: { op: 'add', left: 'left', right: 'right' } }), hasCode('population_mismatch'));
  const prior = (await readQuantitySet(host, id)).state; const excess = await partitionRequest(host, id);
  await assert.rejects(declarePartition(host, { ...excess, op: 'excess-key', declaration: { ...excess.declaration, declaration_id: 'excess-union', evidence: Array.from({ length: 16 }, (_, i) => ({ item_id: `review-${i}`, item_hash: digest(i), field_pointer: '/body' })) } }), hasCode('limit_exceeded'));
  assert.equal((await readQuantitySet(host, id)).revision, sum.revision); assert.deepEqual((await readQuantitySet(host, id)).state, prior);
  const other = { ...input, op: 'other', declaration: { ...input.declaration, declaration_id: 'other' } };
  await assert.rejects(declarePartition(host, other), hasCode('revision_conflict'));
  await declarePartition(host, { ...other, revision: sum.revision });
  assert.equal((await readQuantitySet(host, id)).state.declarations?.length, 2);
});

test('partition review cannot override dimension meaning subject window or overlapping population identities', async t => {
  const cases: [Partial<Quantity>, string][] = [[{ unit_code: 'm' }, 'dimension_mismatch'], [{ semantic_kind: 'different' }, 'semantic_mismatch'], [{ subject_ref: 'different' }, 'population_mismatch'], [{ time_window: 'different' }, 'window_mismatch'], [{ population_key: 'left' }, 'unsafe_overlap'], [{ population_digest: digest('left') }, 'unsafe_overlap']];
  for (const [patch, code] of cases) {
    const { host, id, pmRoot } = await partitionFixture(t, patch); const input = await partitionRequest(host, id); const before = await historyEvents(pmRoot, id);
    await assert.rejects(declarePartition(host, input), hasCode(code)); assert.equal(await historyEvents(pmRoot, id), before);
  }
});

test('partition addition conservatively propagates intervals unknowns and evidence capacity', async t => {
  for (const unknown of [false, true]) {
    const { host, id } = await partitionFixture(t, unknown ? { value: null, unknown_reason: 'Missing member measurement' } : { uncertainty: { lower: { numerator: '100', denominator: '1' }, upper: { numerator: '140', denominator: '1' } } });
    await declarePartition(host, await partitionRequest(host, id)); await deriveQuantity(host, await sumRequest(host, id));
    const { quantity } = await explainQuantity(host, { id, quantity: 'sum' });
    if (unknown) { assert.equal(quantity.value, null); assert.equal(quantity.unknown_reason, 'Missing operands: right'); }
    else assert.deepEqual(quantity.uncertainty, { lower: { numerator: '220', denominator: '1' }, upper: { numerator: '260', denominator: '1' } });
  }
  const { host, id, pmRoot } = await partitionFixture(t); const input = await partitionRequest(host, id); const before = await historyEvents(pmRoot, id);
  input.declaration.evidence = Array.from({ length: 16 }, (_, i) => ({ item_id: `review-${i}`, item_hash: digest(i), field_pointer: '/body' }));
  await assert.rejects(declarePartition(host, input), hasCode('limit_exceeded'));
  assert.equal((await readQuantitySet(host, id)).revision, input.revision); assert.equal((await readQuantitySet(host, id)).state.version, 1);
  assert.equal(await historyEvents(pmRoot, id), before);
  const bounded = await partitionRequest(host, id); bounded.declaration.evidence = Array.from({ length: 15 }, (_, i) => ({ item_id: `review-${i}`, item_hash: digest(i), field_pointer: '/body' }));
  await declarePartition(host, bounded); await deriveQuantity(host, await sumRequest(host, id));
  assert.equal((await readQuantitySet(host, id)).state.derivations[0].quantity.provenance.length, 16);
});
test('partition admission refuses exact operands whose reviewed sum cannot persist', async t => {
  const { host, id, pmRoot } = await fixture(t);
  await recordQuantity(host, await request(host, id, 'left', { value: { numerator: '1', denominator: '7'.repeat(80) }, population_key: 'left', population_digest: digest('left') }));
  await recordQuantity(host, await request(host, id, 'right', { value: { numerator: '1', denominator: '8'.repeat(80) }, population_key: 'right', population_digest: digest('right') }));
  const input = await partitionRequest(host, id); const before = await historyEvents(pmRoot, id);
  await assert.rejects(declarePartition(host, input), hasCode('limit_exceeded'));
  const owner = await readQuantitySet(host, id);
  assert.equal(owner.revision, input.revision); assert.equal(owner.state.version, 1); assert.equal(Object.hasOwn(owner.state, 'declarations'), false);
  assert.equal(await historyEvents(pmRoot, id), before);
});

test('previously admitted over-capacity partitions remain readable and replayable without rewriting', async t => {
  const { host, id, pmRoot } = await partitionFixture(t); const input = await partitionRequest(host, id);
  input.declaration.evidence = Array.from({ length: 16 }, (_, i) => ({ item_id: `review-${i}`, item_hash: digest(i), field_pointer: '/body' }));
  // Reproduce the pre-preview writer's persisted version-2 declaration and receipt.
  const state = (await readQuantitySet(host, id)).state;
  state.version = 2; state.declarations = [input.declaration];
  const result = { kind: 'declare' as const, identity: input.declaration.declaration_id, sequence: state.operations.length + 1, digest: digest(input.declaration) };
  state.operations.push({ operation_id: input.op, request_digest: digest(input), result, result_digest: digest(result) });
  await host.client.update(id, { field: [`unit_state=${canonical(state)}`] });
  const owner = await readQuantitySet(host, id); const before = await historyEvents(pmRoot, id);
  assert.equal(canonical(readState(state)), canonical(state)); assert.deepEqual(owner.state, state);
  const replay = await declarePartition(host, input);
  assert.equal(replay.replayed, true); assert.deepEqual(replay.result, result); assert.equal(replay.revision, owner.revision);
  await assert.rejects(deriveQuantity(host, await sumRequest(host, id)), hasCode('limit_exceeded'));
  assert.equal((await readQuantitySet(host, id)).revision, owner.revision); assert.equal(await historyEvents(pmRoot, id), before);
});

test('partition read-back rejects changed declarations pins inventories and unsupported states', async t => {
  const { host, id } = await partitionFixture(t); await declarePartition(host, await partitionRequest(host, id));
  const unused = (await readQuantitySet(host, id)).state; unused.declarations![0].rationale = 'Changed before any derivation'; assert.throws(() => readState(unused), hasCode('invalid_record'));
  await deriveQuantity(host, await sumRequest(host, id));
  const state = (await readQuantitySet(host, id)).state;
  const changes = [
    (copy: typeof state) => { copy.declarations![0].rationale = 'Changed'; },
    (copy: typeof state) => { copy.declarations!.push(copy.declarations![0]); },
    (copy: typeof state) => { copy.declarations![0].operands[0].digest = digest('stale'); },
    (copy: typeof state) => { copy.derivations[0].declaration_digest = digest('different'); },
    (copy: typeof state) => { delete copy.declarations; },
    (copy: typeof state) => { copy.version = 1; },
    (copy: typeof state) => { copy.declarations![0].version = 2 as 1; },
    (copy: typeof state) => { copy.declarations!.push({ ...copy.declarations![0], declaration_id: 'orphan' }); },
    (copy: typeof state) => { const op = copy.operations[3]; op.result = { ...op.result, kind: 'record', identity: 'left', digest: digest(copy.observations[0]) }; op.result_digest = digest(op.result); },
  ];
  for (const change of changes) { const copy = structuredClone(state); change(copy); assert.throws(() => readState(copy), hasCode('invalid_record')); }
  assert.throws(() => readState({ ...state, version: 3 }), hasCode('unsupported_version'));
  assert.deepEqual(readState(state), state);
  const input = await partitionRequest(host, id);
  for (let i = 1; i < 32; i++) await declarePartition(host, { ...input, op: `declare-${i}`, revision: (await readQuantitySet(host, id)).revision, declaration: { ...input.declaration, declaration_id: `partition-${i}` } });
  const revision = (await readQuantitySet(host, id)).revision;
  await assert.rejects(declarePartition(host, { ...input, op: 'excess', revision, declaration: { ...input.declaration, declaration_id: 'excess' } }), hasCode('limit_exceeded'));
  assert.equal((await readQuantitySet(host, id)).revision, revision);
  const duplicateReceipt = (await readQuantitySet(host, id)).state;
  const last = duplicateReceipt.operations.at(-1)!; last.result.identity = 'partition'; last.result.digest = digest(duplicateReceipt.declarations![0]); last.result_digest = digest(last.result);
  assert.throws(() => readState(duplicateReceipt), hasCode('invalid_record'));
});

test('partition CLI shares SDK validation budgets and complete JSON TOON witnesses', async t => {
  const { host, id, pmRoot } = await partitionFixture(t); const input = await partitionRequest(host, id);
  const harness = await createExtensionTestHarness(extension, { capabilities: ['commands', 'schema', 'renderers'] }); t.after(() => harness.deactivate()); harness.assertCommandContract({ command: 'unit declare' });
  const options = { op: input.op, revision: input.revision, input: JSON.stringify({ declaration: input.declaration }) };
  const tiny = await harness.runCommand({ command: 'unit declare', args: [id], options: { ...options, budget: '1' }, pmRoot });
  assert.equal((tiny.result as UnitResult).refusal?.code, 'output_budget'); assert.equal((await readQuantitySet(host, id)).revision, input.revision);
  const execution = await harness.runCommand({ command: 'unit declare', args: [id], options, pmRoot }); assert.equal((execution.result as UnitResult).ok, true);
  const sum = await sumRequest(host, id);
  const derived = await harness.runCommand({ command: 'unit derive', args: [id], options: { op: sum.op, revision: sum.revision, input: JSON.stringify({ quantity_id: sum.quantity_id, expression: sum.expression }) }, pmRoot }); assert.equal((derived.result as UnitResult).ok, true);
  const output = await harness.runCommand({ command: 'unit explain', args: [id], options: { quantity: 'sum', budget: '8192' }, pmRoot });
  assert.deepEqual((output.result as UnitResult).data, await explainQuantity(host, { id, quantity: 'sum' }));
  const json = await harness.runRendererOverride({ format: 'json', command: 'unit explain', result: output.result });
  const toon = await harness.runRendererOverride({ format: 'toon', command: 'unit explain', result: output.result });
  assert.deepEqual(JSON.parse(String(json.rendered)), decodeToon(String(toon.rendered)));
});
