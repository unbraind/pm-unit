import { isPmCliExpectedError } from '@unbrained/pm-cli/sdk';
/** Typed domain refusal with a public remedy and no submitted text in diagnostics. */
export class UnitRefusal extends Error {
  /** Machine-readable refusal category. */
  readonly code: string;
  /** Safe recovery instruction for callers. */
  readonly remedy: string;
  /** Whether rereading and retrying the original request can succeed. */
  readonly retryable: boolean;
  /** Bounded diagnostic metadata for callers. */
  readonly details: Record<string, unknown>;
  /** Preserve the native host exit contract. */
  readonly nativeExit?: number;
  /** Construct a refusal without reflecting input. */
  constructor(code: string, message: string, remedy = 'Review the input using the documented schema', details: Record<string, unknown> = {}, nativeExit?: number) {
    super(message); this.name = 'UnitRefusal'; this.code = code; this.remedy = remedy; this.details = details; this.nativeExit = nativeExit;
    this.retryable = ['revision_conflict', 'contention', 'stale_cursor'].includes(code);
  }
}
/** Enforce a domain invariant before writing. */
export function insist(ok: unknown, code: string, message: string, remedy?: string, details?: Record<string, unknown>): asserts ok {
  if (!ok) throw new UnitRefusal(code, message, remedy, details);
}
/** Preserve host contract errors; never echo arbitrary system errors or submitted text. */
export function refusal(error: unknown): UnitRefusal {
  if (error instanceof UnitRefusal) return error;
  if (isPmCliExpectedError(error) && typeof error.code === 'string') {
    const remedy = 'remedy' in error && typeof error.remedy === 'string' ? error.remedy : typeof error.context.required === 'string' ? error.context.required : 'Reread the authorized owner and reconcile the original operation key';
    return new UnitRefusal(error.code === 'item_revision_conflict' ? 'revision_conflict' : error.code, 'Native host refused the operation', remedy, {}, error.exitCode);
  }
  return new UnitRefusal('outcome_unknown', 'The host outcome could not be verified', 'Read back the original operation key before retrying; retain the same key');
}
/** Public process exit categories. */
export function exitCode(code: string, nativeExit?: number): number {
  if (nativeExit !== undefined) return nativeExit;
  if (code === 'not_found') return 3;
  if (['revision_conflict', 'operation_conflict', 'stale_cursor', 'contention', 'dimension_mismatch', 'semantic_mismatch', 'population_mismatch', 'window_mismatch', 'unsafe_overlap', 'divide_by_zero', 'unknown_operand', 'derivation_cycle'].includes(code)) return 4;
  if (['backend_unsupported', 'permission_denied', 'incomplete_read', 'outcome_unknown'].includes(code)) return 5;
  return 2;
}
