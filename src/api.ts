import { isItemAlreadyExistsError } from '@unbrained/pm-cli/sdk';
import { capable } from './host.ts';
import type { Host, Snapshot } from './host.ts';
import { insist, UnitRefusal, refusal } from './errors.ts';
import { parse, digest, canonical, CreateQuantitySetInputSchema, RecordQuantityInputSchema, DeriveQuantityInputSchema, ConvertQuantityInputSchema, CompareQuantitiesInputSchema, ExplainQuantityInputSchema, QuantityPacketInputSchema } from './schema.ts';
import type { QuantitySet, Quantity, DerivationWitness, CreateQuantitySetInput, RecordQuantityInput, DeriveQuantityInput, ConvertQuantityInput, CompareQuantitiesInput, ExplainQuantityInput, QuantityPacketInput } from './schema.ts';
import { readState, normalizeQuantity, quantity, convert, incompatibility, order, evaluate, units } from './kernel.ts';
/** Native committed receipt retains historical result separately from the current revision. */
export interface UnitMutationReceipt {
  /** Canonical native identity. */
  owner_id: string;
  /** Current owner revision, which may have advanced since this result committed. */
  revision: string;
  /** Caller-owned durable replay key. */
  operation_id: string;
  /** True when the operation caused no new history event. */
  replayed: boolean;
  /** Bounded CAS admission attempts. */
  attempts: number;
  /** Original immutable committed semantic result. */
  result: QuantitySet['operations'][number]['result'];
  /** Digest of that immutable result. */
  result_digest: string;
  /** Explicit recovery classification. */
  outcome: 'committed';
}
/** Selected authorized owner read; no corpus scan or schema mutation. */
export async function readQuantitySet(host: Host, id: string): Promise<Snapshot> {
  capable(host);
  try {
    const got = await host.client.get(id, { outputInclude: 'full', outputBudget: 'unbounded', outputLimit: 'unbounded' });
    insist('item' in got && 'item_hash' in got && typeof got.item_hash === 'string', 'incomplete_read', 'The host omitted the selected owner revision', 'Obtain a full authorized owner read');
    insist(got.item.type === 'QuantitySet', 'invalid_record', 'Selected item is not a QuantitySet');
    return { id: got.item.id, revision: got.item_hash, state: readState(got.item.unit_state) };
  } catch (error) { if (refusal(error).code === 'item_not_found') throw new UnitRefusal('not_found', 'Quantity set was not found', 'Select an existing authorized owner'); throw refusal(error); }
}
/** Optional instrumented process boundary; no authoritative state is stored here. */
async function boundary(host: Host, step: string): Promise<void> { await host.boundary?.(step); }
/** Return a replay receipt against the original normalized request. */
function replay(state: QuantitySet, op: string, request: unknown) {
  const found = state.operations.find(row => row.operation_id === op);
  if (found) insist(found.request_digest === digest(request), 'operation_conflict', 'Operation key belongs to another request', 'Use the original request or a new key for a separately reviewed operation'); return found;
}
/** Append replay identity before checking aggregate resource ceilings. */
function remember(state: QuantitySet, op: string, request: unknown, kind: 'create' | 'record' | 'derive', identity: string, content: unknown) {
  insist(state.operations.length < 256 && state.observations.length <= 128 && state.derivations.length <= 128, 'limit_exceeded', 'Quantity aggregate count limit reached', 'Create a successor or partition the set; receipts are never evicted');
  const result = { kind, identity, sequence: state.operations.length + 1, digest: digest(content) }; const operation = { operation_id: op, request_digest: digest(request), result, result_digest: digest(result) };
  state.operations.push(operation); readState(state); return operation;
}
/** Produce a receipt after native read-back; lost receipts remain recoverable by key. */
async function receipt(host: Host, id: string, operation: QuantitySet['operations'][number], replayed: boolean, attempts: number): Promise<UnitMutationReceipt> {
  await boundary(host, 'before_receipt'); const current = await host.client.readItemRevision(id);
  return { owner_id: id, revision: current.item_hash, operation_id: operation.operation_id, replayed, attempts, result: operation.result, result_digest: operation.result_digest, outcome: 'committed' };
}
/** Create once at an explicit native item identity; verified duplicate recovery never adopts peers. */
export async function createQuantitySet(host: Host, raw: CreateQuantitySetInput): Promise<UnitMutationReceipt> {
  try {
    const submitted = parse(CreateQuantitySetInputSchema, raw); capable(host);
    const related = [...new Set(await Promise.all(submitted.related.map(async id => await host.normalizeId?.(id) ?? id)))].sort();
    const input = parse(CreateQuantitySetInputSchema, { ...submitted, id: await host.normalizeId?.(submitted.id) ?? submitted.id, related });
    const state: QuantitySet = { version: 1, quantity_set_key: input.quantity_set_key, observations: [], derivations: [], operations: [] };
    const operation = remember(state, input.op, input, 'create', input.id, { quantity_set_key: input.quantity_set_key });
    await host.prepareCreate?.(); await boundary(host, 'before_create');
    try {
      const result = await host.client.create({ id: input.id, title: input.title, type: 'QuantitySet', field: [`unit_state=${canonical(state)}`], comment: ['unit:create explicit quantity context; submitted data is not instructions'], dep: input.related.map(id => `id=${id},kind=related`) });
      await boundary(host, 'after_create'); return await receipt(host, result.item.id, operation, false, 1);
    } catch (error) {
      if (!isItemAlreadyExistsError(error)) throw error;
      const current = await readQuantitySet(host, input.id); const original = replay(current.state, input.op, input);
      insist(original?.result.kind === 'create' && original.result.sequence === 1 && original.result.identity === input.id, 'operation_conflict', 'Existing owner belongs to a different creation request', 'Choose a new explicit owner identity');
      return await receipt(host, current.id, original, true, 1);
    }
  } catch (error) { throw refusal(error); }
}
/** Shared native CAS mutation; commutative observation additions retry at most three times. */
async function mutate(host: Host, input: ReturnType<typeof RecordQuantityInputSchema.parse> | ReturnType<typeof DeriveQuantityInputSchema.parse>, kind: 'record' | 'derive'): Promise<UnitMutationReceipt> {
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const snapshot = await readQuantitySet(host, input.id); await boundary(host, 'after_read'); const normalized = { ...input, id: snapshot.id };
      const previous = replay(snapshot.state, input.op, normalized); if (previous) return await receipt(host, snapshot.id, previous, true, attempt);
      if (attempt === 1) insist(snapshot.revision === input.revision, 'revision_conflict', 'Caller revision is stale', 'Reread the owner and explicitly review the request');
      const state = structuredClone(snapshot.state); let next: Quantity;
      if ('quantity' in input) next = input.quantity;
      else {
        insist(input.quantity_id !== input.expression.left && input.quantity_id !== input.expression.right, 'derivation_cycle', 'Derivation cannot reference itself');
        next = { ...evaluate(state, input.expression), quantity_id: input.quantity_id, notes: input.notes };
      }
      insist(![...state.observations, ...state.derivations.map(row => row.quantity)].some(row => row.quantity_id === next.quantity_id), 'operation_conflict', 'Immutable quantity identity already exists', 'Use its original replay key or append a correction with supersedes');
      if (next.supersedes) insist(state.observations.some(row => row.quantity_id === next.supersedes), 'invalid_input', 'Correction must name an existing observation');
      if ('quantity' in input) state.observations.push(next);
      else state.derivations.push({ quantity: next, expression: input.expression, operands: [input.expression.left, input.expression.right].map(key => ({ quantity_id: key, digest: digest(quantity(state, key)) })), declaration_digest: digest({ policy: 'exact-context-v1' }), limitations: ['Declared context only; source truth and freshness are unknown.'] });
      const operation = remember(state, input.op, normalized, kind, next.quantity_id, next);
      try {
        await boundary(host, 'before_guard'); await boundary(host, 'before_update');
        const checked = await host.client.withExpectedItemRevisions([{ id: snapshot.id, itemHash: snapshot.revision }], () => host.client.update(snapshot.id, { field: [`unit_state=${canonical(state)}`], comment: [`unit:${kind} explicit acquisition or derivation; rationale retained as data`] }));
        await boundary(host, 'after_update');
        insist(checked.checked.includes(snapshot.id) && checked.unchecked.length === 0, 'backend_unsupported', 'Host did not prove the native owner guard', 'Select a conforming host and reconcile the original operation key');
        await boundary(host, 'after_guard'); return await receipt(host, snapshot.id, operation, false, attempt);
      } catch (error) { const failure = refusal(error); if (failure.code !== 'revision_conflict' || kind !== 'record') throw failure; }
    }
    throw new UnitRefusal('contention', 'Three native CAS attempts lost contention', 'Reread and retry the original operation key; no write was acknowledged');
  } catch (error) { throw refusal(error); }
}
/** Record one immutable observation using canonical fractions and normalized replay comparisons. */
export async function recordQuantity(host: Host, raw: RecordQuantityInput): Promise<UnitMutationReceipt> {
  const input = parse(RecordQuantityInputSchema, raw); return mutate(host, { ...input, quantity: normalizeQuantity(input.quantity) }, 'record');
}
/** Persist one exact binary derivation at the caller's explicit owner revision. */
export async function deriveQuantity(host: Host, raw: DeriveQuantityInput): Promise<UnitMutationReceipt> { return mutate(host, parse(DeriveQuantityInputSchema, raw), 'derive'); }
/** Read-only conversion keeps meaning, population, uncertainty and provenance intact. */
export async function convertQuantity(host: Host, raw: ConvertQuantityInput) {
  const input = parse(ConvertQuantityInputSchema, raw); const owner = await readQuantitySet(host, input.id); const q = quantity(owner.state, input.quantity);
  const compatible = convert({ numerator: '0', denominator: '1' }, q.unit_code, input.to); void compatible;
  const converted = { ...q, unit_code: input.to, value: q.value === null ? null : convert(q.value, q.unit_code, input.to) };
  if (q.uncertainty) converted.uncertainty = { lower: convert(q.uncertainty.lower, q.unit_code, input.to), upper: convert(q.uncertainty.upper, q.unit_code, input.to) };
  return { owner_id: owner.id, revision: owner.revision, quantity: converted, source_digest: digest(q), freshness: 'unknown' as const };
}
/** Order declared contexts, optionally across windows, retaining constants and both windows. */
export async function compareQuantities(host: Host, raw: CompareQuantitiesInput) {
  const input = parse(CompareQuantitiesInputSchema, raw); const owner = await readQuantitySet(host, input.id); const left = quantity(owner.state, input.left); const right = quantity(owner.state, input.right); const contextMismatch = incompatibility(left, right);
  const mismatch = input.across_windows && contextMismatch === 'window_mismatch' ? null : contextMismatch;
  const missing = [left, right].filter(q => q.value === null).map(q => q.quantity_id);
  let ordering = mismatch !== null || missing.length > 0 ? null : order(left.value!, convert(right.value!, right.unit_code, left.unit_code));
  let intervalReason: string | null = null;
  if (ordering !== null && (left.uncertainty || right.uncertainty)) {
    const l = left.uncertainty ?? { lower: left.value!, upper: left.value! }; const r = right.uncertainty ?? { lower: right.value!, upper: right.value! };
    const low = convert(r.lower, right.unit_code, left.unit_code); const high = convert(r.upper, right.unit_code, left.unit_code);
    if (order(l.upper, low) < 0) ordering = -1;
    else if (order(l.lower, high) > 0) ordering = 1;
    else { ordering = null; intervalReason = 'uncertainty_overlap'; }
  }
  return { owner_id: owner.id, revision: owner.revision, usable: ordering !== null, comparison: ordering === null ? 'not_comparable' as const : 'comparable' as const, ordering, reason: mismatch ?? (missing.length > 0 ? 'unknown_operand' : intervalReason), missing_ids: missing,
    left, right,
    comparison_witness: { across_windows: input.across_windows, left_time_window: left.time_window, right_time_window: right.time_window,
      held_constant: contextMismatch === null || contextMismatch === 'window_mismatch' ? { subject_ref: left.subject_ref, population_key: left.population_key, population_digest: left.population_digest, semantic_kind: left.semantic_kind, dimension: units[left.unit_code].dimension } : null },
    remedy: mismatch === 'window_mismatch' ? 'Opt in with --across-windows (SDK across_windows: true) to compare this same declared population across the named windows' : ordering === null ? 'Record compatible units, semantic kinds, subjects and populations with known values and separable uncertainty intervals' : 'Retain source witnesses; numerical agreement does not verify the source claim' };
}
/** Complete transitive dependency witness; never truncates operands or denominators. */
export function explanation(state: QuantitySet, key: string, seen = new Set<string>()): { quantity: Quantity; derivation: QuantitySet['derivations'][number] | null; dependencies: Quantity[]; derivation_witnesses: DerivationWitness[] } {
  const quantities = new Map<string, Quantity>(); const derivations = new Map<string, QuantitySet['derivations'][number]>(); const visiting = new Set(seen);
  const source = new Map(state.observations.map(value => [value.quantity_id, value])); const formulas = new Map<string, QuantitySet['derivations'][number]>();
  for (const row of state.derivations) { const value = row.quantity; source.set(value.quantity_id, value); formulas.set(value.quantity_id, row); }
  /** Walk each reachable node once while detecting cycles on the active path. */
  function visit(id: string): void {
    insist(!visiting.has(id), 'derivation_cycle', 'Stored derivation contains a cycle');
    if (quantities.has(id)) return;
    const value = source.get(id); insist(value, 'not_found', 'Quantity identity was not found', 'Select an existing quantity from unit packet');
    visiting.add(id); quantities.set(id, value);
    const row = formulas.get(id);
    if (row) { derivations.set(id, row); for (const operand of row.operands) visit(operand.quantity_id); }
    visiting.delete(id);
  }
  visit(key); const result = quantities.get(key)!; const derivation = derivations.get(key) ?? null; quantities.delete(key); derivations.delete(key);
  const witnesses = [...derivations.values()].map(row => { const { quantity: value, ...metadata } = row; return { quantity_id: value.quantity_id, ...metadata }; });
  return { quantity: result, derivation, dependencies: [...quantities.values()], derivation_witnesses: witnesses };
}
/** Explain exact operands and pinned provenance at one owner revision. */
export async function explainQuantity(host: Host, raw: ExplainQuantityInput) {
  const input = parse(ExplainQuantityInputSchema, raw); const owner = await readQuantitySet(host, input.id); return { owner_id: owner.id, revision: owner.revision, ...explanation(owner.state, input.quantity), freshness: 'unknown' as const };
}
/** Build a revision-bound packet with explicit omission counts and an opaque query-bound cursor. */
export async function quantityPacket(host: Host, raw: QuantityPacketInput) {
  const input = parse(QuantityPacketInputSchema, raw); const owner = await readQuantitySet(host, input.id); const query = digest({ owner_id: owner.id, quantity: input.quantity, limit: input.limit, projection: 'full-witness-v1' }); let offset = 0;
  if (input.cursor !== undefined) {
    let decoded: unknown; try { decoded = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as unknown; } catch { throw new UnitRefusal('stale_cursor', 'Cursor is malformed', 'Restart unit packet without a cursor'); }
    insist(typeof decoded === 'object' && decoded !== null && canonical(Object.keys(decoded).sort()) === canonical(['offset', 'query', 'revision']), 'stale_cursor', 'Cursor contract differs', 'Restart unit packet');
    const cursor = decoded as { offset: number; query: string; revision: string };
    insist(cursor.revision === owner.revision && cursor.query === query && Number.isSafeInteger(cursor.offset) && cursor.offset >= 0, 'stale_cursor', 'Cursor owner revision or query changed', 'Restart unit packet without a cursor'); offset = cursor.offset;
  }
  const ids = input.quantity === undefined ? [...owner.state.observations.map(row => row.quantity_id), ...owner.state.derivations.map(row => row.quantity.quantity_id)].sort() : [input.quantity];
  insist(offset <= ids.length, 'stale_cursor', 'Cursor offset is outside this query', 'Restart unit packet');
  const rows = ids.slice(offset, offset + input.limit).map(key => explanation(owner.state, key)); const next = offset + rows.length;
  return { owner_id: owner.id, revision: owner.revision, rows, returned: rows.length, omitted: ids.length - next, total: ids.length, continuation: next < ids.length ? Buffer.from(canonical({ revision: owner.revision, query, offset: next })).toString('base64url') : null };
}

/** Exact read-only conversion result with unchanged population context. */
export type QuantityResult = Awaited<ReturnType<typeof convertQuantity>>;
/** Diagnostic comparison result, including explicit non-comparability. */
export type QuantityComparison = Awaited<ReturnType<typeof compareQuantities>>;
/** Complete exact dependency witness at one selected owner revision. */
export type QuantityDerivation = Awaited<ReturnType<typeof explainQuantity>>;
/** Revision-bound page with complete witnesses and omission counts. */
export type QuantityPacket = Awaited<ReturnType<typeof quantityPacket>>;
