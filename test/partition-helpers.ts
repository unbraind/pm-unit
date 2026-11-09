import type { TestContext } from 'node:test';
import type { Quantity, PartitionDeclaration, Host } from '../dist/index.js';
import { digest, readQuantitySet, recordQuantity } from '../dist/index.js';
import { fixture, request } from './helpers.ts';

/** Real no-git owner with two explicitly different member populations. */
export async function partitionFixture(t: TestContext, right: Partial<Quantity> = {}) {
  const context = await fixture(t);
  await recordQuantity(context.host, await request(context.host, context.id, 'left', { population_key: 'left', population_digest: digest('left') }));
  await recordQuantity(context.host, await request(context.host, context.id, 'right', { population_key: 'right', population_digest: digest('right'), ...right }));
  return context;
}

/** Review pins canonical operands already persisted by the real SDK. */
export async function partitionRequest(host: Host, id: string) {
  const owner = await readQuantitySet(host, id);
  const declaration: PartitionDeclaration = {
    version: 1, declaration_id: 'partition', kind: 'disjoint_partition',
    operands: owner.state.observations.slice(0, 2).map(q => ({ quantity_id: q.quantity_id, digest: digest(q) })),
    population_key: 'union', population_digest: digest('union'), reviewed_by: 'reviewer', reviewed_at: '2026-11-06T00:00:00Z',
    rationale: 'Reviewed distinct member sets with a common measurement definition.',
    evidence: [{ item_id: 'corpus-review', item_hash: digest('review evidence'), field_pointer: '/body' }],
  };
  return { id, op: 'declare-partition', revision: owner.revision, declaration };
}

/** Explicitly bind an additive expression to its immutable reviewed declaration. */
export async function sumRequest(host: Host, id: string) {
  return { id, op: 'sum', revision: (await readQuantitySet(host, id)).revision, quantity_id: 'sum', expression: { op: 'add' as const, left: 'left', right: 'right', declaration_id: 'partition' } };
}
