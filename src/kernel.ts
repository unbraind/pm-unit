import { insist, UnitRefusal } from './errors.ts';
import { parse, RationalSchema, UnitCodeSchema, QuantityInputSchema, QuantitySetSchema, ExpressionSchema, digest, canonical } from './schema.ts';
import type { Rational, Quantity, QuantitySet, UnitCode, Expression } from './schema.ts';
/** Exact rational reduction, including safe negative zero and precision limits. */
export function rational(value: Rational): Rational {
  const input = parse(RationalSchema, value); let n = BigInt(input.numerator); let d = BigInt(input.denominator);
  let a = n < 0n ? -n : n; let b = d;
  while (b !== 0n) { const next = a % b; a = b; b = next; }
  n /= a; d /= a;
  return { numerator: n.toString(), denominator: d.toString() };
}
/** Normalize a checked intermediate without unsafe floating point arithmetic. */
function checked(n: bigint, d: bigint): Rational {
  insist(d !== 0n, 'divide_by_zero', 'The exact denominator is zero', 'Record a nonzero denominator witness');
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n; let b = d;
  while (b !== 0n) { const next = a % b; a = b; b = next; }
  const result = { numerator: (n / a).toString(), denominator: (d / a).toString() };
  insist(result.numerator.replace('-', '').length <= 80 && result.denominator.length <= 80, 'limit_exceeded', 'Exact rational precision exceeds eighty digits', 'Partition the calculation or submit smaller exact operands');
  return result;
}
/** Exact four-operation arithmetic with checked intermediate growth. */
export function arithmetic(left: Rational, right: Rational, op: Expression['op']): Rational {
  insist(['add', 'subtract', 'multiply', 'divide'].includes(op), 'invalid_input', 'Unsupported arithmetic operation');
  const l = rational(left); const r = rational(right); const a = BigInt(l.numerator); const b = BigInt(l.denominator); const c = BigInt(r.numerator); const d = BigInt(r.denominator);
  if (op === 'add') return checked(a * d + c * b, b * d);
  if (op === 'subtract') return checked(a * d - c * b, b * d);
  if (op === 'multiply') return checked(a * c, b * d);
  return checked(a * d, b * c);
}
/** Exact ordering never uses rounded display values. */
export function order(left: Rational, right: Rational): -1 | 0 | 1 {
  const l = rational(left); const r = rational(right);
  const delta = BigInt(l.numerator) * BigInt(r.denominator) - BigInt(r.numerator) * BigInt(l.denominator);
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}
/** Finite exact dictionary: dimension and rational scale to the base unit. */
export const units: Record<UnitCode, { dimension: string; factor: Rational }> = {
  s: { dimension: 'time', factor: { numerator: '1', denominator: '1' } }, min: { dimension: 'time', factor: { numerator: '60', denominator: '1' } }, h: { dimension: 'time', factor: { numerator: '3600', denominator: '1' } },
  m: { dimension: 'length', factor: { numerator: '1', denominator: '1' } }, cm: { dimension: 'length', factor: { numerator: '1', denominator: '100' } }, km: { dimension: 'length', factor: { numerator: '1000', denominator: '1' } },
  g: { dimension: 'mass', factor: { numerator: '1', denominator: '1' } }, kg: { dimension: 'mass', factor: { numerator: '1000', denominator: '1' } },
  B: { dimension: 'data', factor: { numerator: '1', denominator: '1' } }, KiB: { dimension: 'data', factor: { numerator: '1024', denominator: '1' } }, MiB: { dimension: 'data', factor: { numerator: '1048576', denominator: '1' } },
  count: { dimension: 'count', factor: { numerator: '1', denominator: '1' } }, token: { dimension: 'token', factor: { numerator: '1', denominator: '1' } },
  ratio: { dimension: 'ratio', factor: { numerator: '1', denominator: '1' } }, '%': { dimension: 'ratio', factor: { numerator: '1', denominator: '100' } },
};
/** Convert one exact value between compatible dimensions. */
export function convert(value: Rational, from: UnitCode, to: UnitCode): Rational {
  parse(UnitCodeSchema, from); parse(UnitCodeSchema, to);
  insist(units[from].dimension === units[to].dimension, 'dimension_mismatch', 'Unit dimensions differ', 'Choose a unit with the same dimension');
  return arithmetic(arithmetic(value, units[from].factor, 'multiply'), units[to].factor, 'divide');
}
/** Normalize both submitted and persisted observations through the same function. */
export function normalizeQuantity(raw: unknown): Quantity {
  const q = parse(QuantityInputSchema, raw);
  if (q.value !== null) q.value = rational(q.value);
  if (q.uncertainty) {
    q.uncertainty = { lower: rational(q.uncertainty.lower), upper: rational(q.uncertainty.upper) };
    insist(q.value !== null && order(q.uncertainty.lower, q.value) <= 0 && order(q.value, q.uncertainty.upper) <= 0, 'invalid_input', 'Interval must contain the declared value');
  }
  return q;
}
/** Selected immutable observation or derived quantity; absence never becomes zero. */
export function quantity(state: QuantitySet, id: string): Quantity {
  const found = [...state.observations, ...state.derivations.map(row => row.quantity)].find(row => row.quantity_id === id);
  insist(found, 'not_found', 'Quantity identity was not found', 'Select an existing quantity from unit packet'); return found;
}
/** Compare dimensions, meaning and declared population independently. */
export function incompatibility(left: Quantity, right: Quantity): string | null {
  if (units[left.unit_code].dimension !== units[right.unit_code].dimension) return 'dimension_mismatch';
  if (left.semantic_kind !== right.semantic_kind) return 'semantic_mismatch';
  if (left.subject_ref !== right.subject_ref || left.population_key !== right.population_key || left.population_digest !== right.population_digest || left.time_window !== right.time_window) return 'population_mismatch';
  return null;
}
/** Evaluate a bounded typed expression, retaining denominator witnesses and unknowns. */
export function evaluateQuantityExpression(raw: QuantitySet, expression: Expression): Quantity {
  const state = readState(raw); const ast = parse(ExpressionSchema, expression); return evaluate(state, ast);
}
/** Shared deterministic evaluator for admitted state; no shell or expression evaluation. */
export function evaluate(state: QuantitySet, ast: Expression): Quantity {
  const left = quantity(state, ast.left); const right = quantity(state, ast.right); const additive = ast.op === 'add' || ast.op === 'subtract';
  if (additive) {
    const mismatch = incompatibility(left, right); insist(mismatch === null, mismatch ?? 'invalid_input', 'Operands have incompatible context', 'Record matching observations; reviewed compatibility declarations are deferred');
    insist(ast.op !== 'add', 'unsafe_overlap', 'A disjoint additive partition is not witnessed', 'Retain separate observations until reviewed partition declarations are supported');
  } else insist(left.subject_ref === right.subject_ref && left.population_key === right.population_key && left.population_digest === right.population_digest && left.time_window === right.time_window, 'population_mismatch', 'Multiplicative populations differ', 'Record operands on the same explicit population and window');
  let unit = left.unit_code; let rightUnit = right.unit_code;
  if (!additive) {
    if (units[right.unit_code].dimension === 'ratio') rightUnit = 'ratio';
    else { insist(ast.op === 'divide' && units[left.unit_code].dimension === units[right.unit_code].dimension, 'unsupported_unit', 'Compound dimensions are deferred in the first release', 'Use a dimensionless scale or a same-dimension exact ratio'); unit = 'ratio'; rightUnit = left.unit_code; }
  } else rightUnit = left.unit_code;
  const valueRight = right.value === null ? null : convert(right.value, right.unit_code, rightUnit);
  if (ast.op === 'divide' && valueRight !== null) insist(BigInt(valueRight.numerator) !== 0n, 'divide_by_zero', 'The denominator witness is zero', 'Record a nonzero denominator witness');
  const result = { ...left, quantity_id: 'evaluated', value: left.value === null || valueRight === null ? null : arithmetic(left.value, valueRight, ast.op), unit_code: unit,
    semantic_kind: additive ? left.semantic_kind : `${ast.op}.${digest([left.semantic_kind, right.semantic_kind]).slice(0, 24)}`,
    provenance: [...new Map([...left.provenance, ...right.provenance].map(ref => [digest(ref), ref])).values()], notes: '', acquisition: 'estimated' as const,
  };
  delete result.uncertainty; delete result.supersedes; delete result.correction_reason; delete result.unknown_reason;
  if (result.value === null) result.unknown_reason = `Missing operands: ${[left.value === null ? ast.left : '', right.value === null ? ast.right : ''].filter(Boolean).join(', ')}`;
  else if (left.uncertainty || right.uncertainty) {
    const l = left.uncertainty ?? { lower: left.value!, upper: left.value! }; const r = right.uncertainty ?? { lower: right.value!, upper: right.value! };
    const bounds = [convert(r.lower, right.unit_code, rightUnit), convert(r.upper, right.unit_code, rightUnit)];
    if (ast.op === 'divide') insist(!(order(bounds[0], { numerator: '0', denominator: '1' }) <= 0 && order(bounds[1], { numerator: '0', denominator: '1' }) >= 0), 'divide_by_zero', 'Denominator interval contains zero', 'Record a denominator interval excluding zero');
    const corners = [l.lower, l.upper].flatMap(a => bounds.map(b => arithmetic(a, b, ast.op))).sort(order);
    result.uncertainty = { lower: corners[0], upper: corners[3] };
  }
  return normalizeQuantity(result);
}
/** Fail closed on corruption, unsupported versions and broken immutable replay witnesses. */
export function readState(raw: unknown): QuantitySet {
  insist(typeof raw === 'object' && raw !== null && 'version' in raw, 'invalid_record', 'Missing unit state');
  insist(raw.version === 1, 'unsupported_version', 'Unsupported quantity state version', 'Upgrade the package; do not rewrite future state');
  try {
  const state = parse(QuantitySetSchema, raw, true);
  const all = [...state.observations, ...state.derivations.map(row => row.quantity)];
  insist(new Set(all.map(row => row.quantity_id)).size === all.length && new Set(state.operations.map(row => row.operation_id)).size === state.operations.length, 'invalid_record', 'Duplicate immutable identities');
  for (const row of all) { insist(canonical(normalizeQuantity(row)) === canonical(row), 'invalid_record', 'Stored quantity is not canonical'); if (row.supersedes) insist(row.supersedes !== row.quantity_id && all.some(prior => prior.quantity_id === row.supersedes), 'invalid_record', 'Correction reference is invalid'); }
  for (const row of state.derivations) {
    insist(row.declaration_digest === digest({ policy: 'exact-context-v1' }) && row.operands.length === 2, 'invalid_record', 'Derivation declaration is not pinned');
    for (const [index, key] of [row.expression.left, row.expression.right].entries()) insist(row.operands[index].quantity_id === key && key !== row.quantity.quantity_id && row.operands[index].digest === digest(quantity(state, key)), 'invalid_record', 'Derivation input digest changed');
  }
  for (const [index, operation] of state.operations.entries()) {
    insist(operation.result.sequence === index + 1 && operation.result_digest === digest(operation.result), 'invalid_record', 'Replay result is corrupted');
    const target = operation.result.kind === 'create' ? { quantity_set_key: state.quantity_set_key } : quantity(state, operation.result.identity);
    insist(operation.result.digest === digest(target), 'invalid_record', 'Immutable quantity content changed outside its recorded operation');
  }
  insist(state.operations[0].result.kind === 'create' && state.operations.filter(row => row.result.kind === 'create').length === 1 && state.operations.length === all.length + 1, 'invalid_record', 'Record and replay inventories differ');
  const available = new Set(state.observations.map(row => row.quantity_id));
  for (const row of state.derivations) {
    insist(row.operands.every(operand => available.has(operand.quantity_id)), 'invalid_record', 'Derivation dependencies are not acyclic');
    const expected = { ...evaluate(state, row.expression), quantity_id: row.quantity.quantity_id, notes: row.quantity.notes };
    insist(canonical(expected) === canonical(row.quantity), 'invalid_record', 'Derived result does not reproduce its exact witnesses'); available.add(row.quantity.quantity_id);
  }
  insist(Buffer.byteLength(canonical(state)) <= 65536, 'limit_exceeded', 'Quantity owner exceeds 64 KiB', 'Create a successor or partition the quantity set; do not evict receipts');
  return state;
  } catch (error) {
    if (error instanceof UnitRefusal && ['invalid_record', 'limit_exceeded'].includes(error.code)) throw error;
    throw new UnitRefusal('invalid_record', 'Stored quantity context failed validation', 'Review the native owner history; do not silently repair it');
  }
}
