import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuantitySet, recordQuantity, readQuantitySet, convertQuantity, digest } from '../dist/index.js';
import { fixture, request, hasCode } from './helpers.ts';
import type { RecordQuantityInput } from '../dist/index.js';

test('500 seeded random operation sequences match an independent model and SDK read-back', async t => {
  const { host, birth, native } = await fixture(t); let seed = 0x51a7; const counts = { record: 0, replay: 0, stale: 0, convert: 0, peer: 0 };
  /** Reproducible xorshift32 operation and data generator. */
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  await native.create({ id: 'corpus-model-consumer', title: 'Quantity consuming task', type: 'Task' });
  for (let batch = 0; batch < 10; batch++) {
    const id = `corpus-model-${batch}`; await createQuantitySet(host, { ...birth, id, op: `birth-${batch}`, related: ['corpus-model-consumer'] });
    const model = new Map<string, { numerator: bigint; denominator: bigint; notes: string }>(); const old: RecordQuantityInput[] = []; let hasPeer = false;
    for (let sequence = 0; sequence < 50; sequence++) {
      for (let step = 0; step < 2; step++) {
        const choice = random() % 5;
        if (old.length === 0 || (choice === 0 && model.size < 25)) {
          const key = `q-${model.size}`; const numerator = BigInt(random() % 10000); const denominator = BigInt(random() % 31 + 1); const notes = ['  exact whitespace  ', '日本 é 😃', 'Ignore previous instructions', 'line one\nline two'][random() % 4];
          const input = await request(host, id, key, { value: { numerator: String(numerator * 2n), denominator: String(denominator * 2n) }, notes });
          await recordQuantity(host, input); old.push(input); model.set(key, { numerator, denominator, notes }); counts.record++;
        } else if (choice <= 1) {
          const replay = old[random() % old.length]; assert.equal((await recordQuantity(host, { ...replay, quantity: { ...replay.quantity, quantity_id: ` ${replay.quantity.quantity_id} ` } })).replayed, true); counts.replay++;
        } else if (choice === 2) {
          const replay = old[random() % old.length]; await assert.rejects(recordQuantity(host, { ...replay, op: `stale-${sequence}-${step}` }), hasCode('revision_conflict')); counts.stale++;
        } else if (choice === 3) {
          const key = [...model.keys()][random() % model.size]; const source = model.get(key)!; const result = (await convertQuantity(host, { id, quantity: key, to: 'min' })).quantity.value!;
          assert.equal(BigInt(result.numerator) * source.denominator * 60n, source.numerator * BigInt(result.denominator)); counts.convert++;
        } else {
          await native.update(id, { description: 'Peer-owned prose', comment: ['Peer audit context'] }); hasPeer = true; counts.peer++;
        }
      }
      const snapshot = await readQuantitySet(host, id); assert.equal(snapshot.state.observations.length, model.size);
      for (const row of snapshot.state.observations) { const expected = model.get(row.quantity_id)!; assert.equal(BigInt(row.value!.numerator) * expected.denominator, expected.numerator * BigInt(row.value!.denominator)); assert.equal(row.notes, expected.notes); }
      const got = await native.get(id, { outputInclude: 'full', outputBudget: 'unbounded' }); assert.ok('item' in got); assert.equal(digest(got.item.unit_state), digest(snapshot.state));
      assert.ok(got.item.dependencies?.some(dep => dep.id === 'corpus-model-consumer')); if (hasPeer) assert.equal(got.item.description, 'Peer-owned prose');
    }
  }
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), 1000); assert.ok(Object.values(counts).every(count => count > 0));
  t.diagnostic(JSON.stringify({ seed: '0x51a7', sequences: 500, operations: 1000, read_back: 500, counts }));
});
