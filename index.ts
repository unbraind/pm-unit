import { defineExtension } from '@unbrained/pm-cli/sdk/authoring';
import { register } from './src/commands.ts';
/** Native quantity extension; activation contributes schema and commands only. */
const extension = defineExtension({ name: 'pm-unit', version: '2026.11.6', description: 'Exact quantities and population context', activate: register });
/** Activate through the native pm extension host. */
export default extension;
/** Portable SDK operations shared by CLI and embedding agents. */
export { createQuantitySet, recordQuantity, deriveQuantity, convertQuantity, compareQuantities, explainQuantity, quantityPacket, readQuantitySet } from './src/api.ts';
/** Historical committed result plus current owner revision. */
export type { UnitMutationReceipt, QuantityResult, QuantityComparison, QuantityDerivation, QuantityPacket } from './src/api.ts';
/** Host-owned authorization and backend capability contracts. */
export { createDirectoryHost } from './src/host.ts';
/** Authorized injected lifecycle port and complete selected-owner snapshot. */
export type { Host, Snapshot } from './src/host.ts';
/** Strict nested contracts for all submitted and stored quantity data. */
export { QuantitySetSchema, QuantityInputSchema, UnitCodeSchema, RationalSchema, ProvenanceSchema, IntervalSchema, ExpressionSchema, DerivationSchema, DerivationWitnessSchema, ReplaySchema, CreateQuantitySetInputSchema, RecordQuantityInputSchema, DeriveQuantityInputSchema, ConvertQuantityInputSchema, CompareQuantitiesInputSchema, ExplainQuantityInputSchema, QuantityPacketInputSchema, canonical, digest } from './src/schema.ts';
/** Public request and domain types for in-process integrations. */
export type { QuantitySet, Quantity, Rational, UnitCode, Expression, DerivationWitness, CreateQuantitySetInput, RecordQuantityInput, DeriveQuantityInput, ConvertQuantityInput, CompareQuantitiesInput, ExplainQuantityInput, QuantityPacketInput } from './src/schema.ts';
/** Pure deterministic exact arithmetic and expression evaluation. */
export { rational, arithmetic, order, convert, evaluateQuantityExpression, readState } from './src/kernel.ts';
/** Strict output contract and serialized whole-envelope fitter. */
export { UnitResultSchema, UnitDataSchema, envelope, fitEnvelope } from './src/output.ts';
/** Common output types. */
export type { UnitResult, UnitData } from './src/output.ts';
/** Typed refusals and public process exit categories. */
export { UnitRefusal, exitCode } from './src/errors.ts';
