import { createHash } from 'node:crypto';
import { z } from 'zod';
import { scanMutationSecrets } from '@unbrained/pm-cli/sdk';
import { insist, UnitRefusal } from './errors.ts';
/** Bounded immutable domain identifier; normalization is shared by all requests. */
export const KeySchema = z.string().trim().min(1).max(96).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
/** Canonical SHA-256 identity. */
export const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
/** Exact bounded rational transport. Normalization belongs to rational(). */
export const RationalSchema = z.strictObject({ numerator: z.string().regex(/^-?\d{1,80}$/), denominator: z.string().regex(/^(?!0+$)\d{1,80}$/) });
/** Supported finite first-release units; no guesses, affine units or currencies. */
export const UnitCodeSchema = z.enum(['ms', 's', 'min', 'h', 'm', 'cm', 'km', 'g', 'kg', 'B', 'kB', 'MB', 'GB', 'KiB', 'MiB', 'GiB', 'count', 'token', 'ratio', '%']);
/** A source fragment pins a native revision, independently of current source truth. */
export const ProvenanceSchema = z.strictObject({ item_id: KeySchema, item_hash: DigestSchema, field_pointer: z.string().min(1).max(256), citation_id: KeySchema.optional() });
/** Inclusive conservative uncertainty bounds in the observation's unit. */
export const IntervalSchema = z.strictObject({ lower: RationalSchema, upper: RationalSchema });
/** Declared observation, population and semantic meaning. Text is data. */
export const QuantityInputSchema = z.strictObject({
  quantity_id: KeySchema, value: RationalSchema.nullable(), unknown_reason: z.string().min(1).max(512).optional(), unit_code: UnitCodeSchema,
  semantic_kind: KeySchema, subject_ref: KeySchema, population_key: KeySchema, population_digest: DigestSchema,
  time_window: z.string().min(1).max(128), uncertainty: IntervalSchema.optional(), acquisition: z.enum(['observed', 'reported', 'estimated']),
  observed_at: z.iso.datetime(), provenance: z.array(ProvenanceSchema).min(1).max(16), notes: z.string().max(512).default(''),
  supersedes: KeySchema.optional(), correction_reason: z.string().min(1).max(512).optional(),
}).refine(value => (value.value !== null || value.unknown_reason !== undefined) && ((value.supersedes === undefined) === (value.correction_reason === undefined)));
/** A deliberately bounded first-release exact binary expression, with no executable text. */
export const ExpressionSchema = z.strictObject({ op: z.enum(['add', 'subtract', 'multiply', 'divide']), left: KeySchema, right: KeySchema });
/** Immutable derivation retains operands and exact source digests. */
export const DerivationSchema = z.strictObject({ quantity: QuantityInputSchema, expression: ExpressionSchema, operands: z.array(z.strictObject({ quantity_id: KeySchema, digest: DigestSchema })).length(2), declaration_digest: DigestSchema, limitations: z.array(z.string().max(256)).max(8) });
/** Compact exact intermediate derivation; its quantity is delivered once in the dependency list. */
export const DerivationWitnessSchema = DerivationSchema.omit({ quantity: true }).extend({ quantity_id: KeySchema });
/** Intermediate formula and immutable input fingerprints for an explanation. */
export type DerivationWitness = z.infer<typeof DerivationWitnessSchema>;
/** Immutable semantic mutation result, separate from the current owner revision. */
export const CommittedResultSchema = z.strictObject({ kind: z.enum(['create', 'record', 'derive']), identity: KeySchema, sequence: z.number().int().min(1).max(256), digest: DigestSchema });
/** Replay identity is never evicted to make room for later writes. */
export const ReplaySchema = z.strictObject({ operation_id: KeySchema, request_digest: DigestSchema, result: CommittedResultSchema, result_digest: DigestSchema });
/** Versioned strict aggregate stored only in native unit_state. */
export const QuantitySetSchema = z.strictObject({ version: z.literal(1), quantity_set_key: KeySchema, observations: z.array(QuantityInputSchema).max(128), derivations: z.array(DerivationSchema).max(128), operations: z.array(ReplaySchema).min(1).max(256) });
/** Explicit caller-owned create identity and creation request. */
export const CreateQuantitySetInputSchema = z.strictObject({ id: KeySchema, op: KeySchema, title: z.string().trim().min(1).max(256), quantity_set_key: KeySchema, related: z.array(KeySchema).max(16).default([]) });
const mutation = { id: KeySchema, op: KeySchema, revision: DigestSchema };
/** Explicit revision-checked immutable observation append. */
export const RecordQuantityInputSchema = z.strictObject({ ...mutation, quantity: QuantityInputSchema });
/** Exact binary derivation append; explicit edits never auto-rebase. */
export const DeriveQuantityInputSchema = z.strictObject({ ...mutation, quantity_id: KeySchema, expression: ExpressionSchema, notes: z.string().max(512).default('') });
/** Read-only conversion query. */
export const ConvertQuantityInputSchema = z.strictObject({ id: KeySchema, quantity: KeySchema, to: UnitCodeSchema });
/** Read-only exact ordering query. */
export const CompareQuantitiesInputSchema = z.strictObject({ id: KeySchema, left: KeySchema, right: KeySchema });
/** Exact dependency witness query. */
export const ExplainQuantityInputSchema = z.strictObject({ id: KeySchema, quantity: KeySchema });
/** Revision-bound packet query; cursor is opaque, never an offset alone. */
export const QuantityPacketInputSchema = z.strictObject({ id: KeySchema, quantity: KeySchema.optional(), limit: z.number().int().min(1).max(100).default(20), cursor: z.string().max(1024).optional() });
/** Persisted native quantity aggregate type. */
export type QuantitySet = z.infer<typeof QuantitySetSchema>;
/** Normalized exact quantity observation type. */
export type Quantity = z.infer<typeof QuantityInputSchema>;
/** Exact bounded rational value type. */
export type Rational = z.infer<typeof RationalSchema>;
/** Finite supported unit dictionary key. */
export type UnitCode = z.infer<typeof UnitCodeSchema>;
/** Bounded exact expression type. */
export type Expression = z.infer<typeof ExpressionSchema>;
/** Public SDK quantity creation request. */
export type CreateQuantitySetInput = z.input<typeof CreateQuantitySetInputSchema>;
/** Public SDK quantity recording request. */
export type RecordQuantityInput = z.input<typeof RecordQuantityInputSchema>;
/** Public SDK exact derivation request. */
export type DeriveQuantityInput = z.input<typeof DeriveQuantityInputSchema>;
/** Public SDK quantity conversion request. */
export type ConvertQuantityInput = z.input<typeof ConvertQuantityInputSchema>;
/** Public SDK quantity comparison request. */
export type CompareQuantitiesInput = z.input<typeof CompareQuantitiesInputSchema>;
/** Public SDK dependency explanation request. */
export type ExplainQuantityInput = z.input<typeof ExplainQuantityInputSchema>;
/** Public SDK quantity packet request. */
export type QuantityPacketInput = z.input<typeof QuantityPacketInputSchema>;
/** Stable JSON identity ignores object key order, but preserves array order and exact text. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
/** SHA-256 content identity for source, requests and results. */
export function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
/** Refuse unsafe data before it can enter immutable native history. */
export function guardSubmitted(value: unknown, seen = new Set<object>(), depth = 0): void {
  insist(depth <= 16, 'invalid_input', 'Input nesting exceeds sixteen levels');
  if (typeof value === 'string') {
    insist(value.length <= 8000 && value.isWellFormed(), 'invalid_input', 'Text is oversized or malformed Unicode');
    insist(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value), 'invalid_input', 'Control sequences are forbidden');
    insist(!/(?:[\\/](?:home|Users)[\\/]|[\\/]root(?:[\\/]|\b)|(?<![\w.+-])[\w.+-]+@[\w.-]+\.[a-z]{2,})/iu.test(value), 'invalid_input', 'Private paths and email addresses are forbidden');
    insist(scanMutationSecrets(value).length === 0, 'invalid_input', 'SDK privacy guard detected credential-shaped content');
  } else if (value !== null && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    insist(Array.isArray(value) || prototype === Object.prototype || prototype === null, 'invalid_input', 'Only plain JSON data is supported');
    insist(!seen.has(value), 'invalid_input', 'Cyclic input is forbidden'); seen.add(value);
    for (const name of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name)!;
      insist(typeof name === 'string' && 'value' in descriptor && (descriptor.enumerable || (Array.isArray(value) && name === 'length')), 'invalid_input', 'Only enumerable JSON data properties are supported');
    }
    for (const [name, child] of Object.entries(value)) {
      insist(!['__proto__', 'prototype', 'constructor'].includes(name), 'invalid_input', 'Prototype keys are forbidden'); guardSubmitted(child, seen, depth + 1);
    }
    seen.delete(value);
  }
}
/** Validate strict nested contracts with bounded field names and no raw input in diagnostics. */
export function parse<T>(schema: z.ZodType<T>, value: unknown, stored = false): T {
  if (!stored) guardSubmitted(value);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const unit = (schema as z.ZodType<unknown>) === UnitCodeSchema || parsed.error.issues.some(issue => issue.code === 'invalid_value' && ['unit_code', 'to'].includes(String(issue.path.at(-1))));
    throw new UnitRefusal(stored ? 'invalid_record' : unit ? 'unsupported_unit' : 'invalid_input', 'Strict quantity contract failed', 'Inspect the documented fields and supported unit dictionary', { fields: parsed.error.issues.slice(0, 6).map(issue => issue.path.join('.')) });
  }
  return parsed.data;
}
