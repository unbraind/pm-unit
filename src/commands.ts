import { readSettings, normalizeItemId } from '@unbrained/pm-cli/sdk';
import { defineCommand } from '@unbrained/pm-cli/sdk/authoring';
import type { CommandHandlerContext, ExtensionApi, FlagDefinition } from '@unbrained/pm-cli/sdk/authoring';
import { createQuantitySet, recordQuantity, deriveQuantity, convertQuantity, compareQuantities, explainQuantity, quantityPacket } from './api.ts';
import { parse, CreateQuantitySetInputSchema, RecordQuantityInputSchema, DeriveQuantityInputSchema } from './schema.ts';
import { persistedSchemaPort } from './host.ts';
import type { Host } from './host.ts';
import { insist, refusal, UnitRefusal } from './errors.ts';
import { envelope, fitEnvelope, refusalEnvelope, renderOutput } from './output.ts';
import type { UnitData } from './output.ts';
/** Refuse empty, repeated or non-scalar CLI guards before dispatch. */
function scalar(value: unknown): string { insist(typeof value === 'string' && value.trim().length > 0, 'invalid_input', 'A required scalar option is missing'); return value; }
/** Validate native output controls without rounding or accepting trailing garbage. */
function integer(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  insist((typeof value === 'string' || typeof value === 'number') && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0, 'invalid_input', 'Output control must be a positive integer'); return Number(value);
}
/** Bounded fatal UTF-8 JSON ingestion from inline input or stdin, never a side file. */
export async function inputJson(value: unknown, source: AsyncIterable<Uint8Array> = process.stdin): Promise<Record<string, unknown>> {
  let text = scalar(value);
  if (text === '-') {
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of source) { const data = Buffer.from(chunk); bytes += data.length; insist(bytes <= 32768, 'invalid_input', 'Input exceeds 32 KiB'); chunks.push(data); }
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch { throw new UnitRefusal('invalid_input', 'Malformed UTF-8 JSON'); }
  }
  insist(Buffer.byteLength(text) <= 32768, 'invalid_input', 'Input exceeds 32 KiB'); let data: unknown;
  try { data = JSON.parse(text) as unknown; } catch { throw new UnitRefusal('invalid_input', 'Malformed JSON'); }
  insist(data !== null && typeof data === 'object' && !Array.isArray(data), 'invalid_input', 'Input must be a strict JSON object'); return data as Record<string, unknown>;
}
/** CLI and SDK share one domain API; global output controls are consumed, never shadowed. */
export async function runCommand(command: string, ctx: CommandHandlerContext): Promise<unknown> {
  try {
    insist(ctx.sdk !== undefined, 'backend_unsupported', 'The host did not supply a native SDK client', 'Use pm-cli 2026.11.5 or a conforming authorized host');
    const persisted = (await ctx.sdk.client.schemaListFields()).fields.find(field => field.key === 'unit_state');
    insist(persisted === undefined || persisted.type === 'object', 'invalid_record', 'unit_state has an incompatible schema');
    const host: Host = { client: persisted ? persistedSchemaPort(ctx.sdk.client) : ctx.sdk.client, fitOutputEnvelope: ctx.sdk.fitOutputEnvelope, capabilities: { native_item_cas: true, create_if_absent: true, provider: 'directory-host' }, normalizeId: async id => normalizeItemId(id, (await readSettings(ctx.pm_root)).id_prefix) };
    const settings = (await ctx.sdk.readSettingsSection('unit')).value;
    insist(settings === undefined || (settings !== null && typeof settings === 'object' && !Array.isArray(settings) && Object.keys(settings).every(key => key === 'output_budget')), 'invalid_record', 'Unsupported package settings');
    const policy = settings as { output_budget?: unknown } | undefined; const flags = ctx.options;
    insist(ctx.global.outputInclude === undefined && ctx.global.outputSession === undefined && ctx.global.outputRowContract === undefined, 'invalid_input', 'Generic projection would omit quantity witnesses', 'Use --quantity and --output-limit');
    insist(flags.budget === undefined || ctx.global.outputBudget === undefined, 'invalid_input', 'Choose one budget transport');
    const requestedBudget = flags.budget === undefined ? ctx.global.outputBudget : flags.budget;
    const budget = requestedBudget === 'unbounded' ? 8192 : integer(requestedBudget, integer(policy?.output_budget, 1600));
    insist(command === 'packet' || (ctx.global.outputCursor === undefined && ctx.global.outputLimit === undefined), 'invalid_input', 'Pagination applies only to unit packet');
    insist(flags.cursor === undefined || ctx.global.outputCursor === undefined, 'invalid_input', 'Choose one continuation transport', 'Use --cursor for the package cursor; native producer continuation remains upstream work');
    insist(flags.limit === undefined || ctx.global.outputLimit === undefined, 'invalid_input', 'Choose one limit transport', 'Use --limit or --output-limit, not both');
    const id = await host.normalizeId!(command === 'create' ? scalar(flags.id) : scalar(ctx.args[0])); let data: UnitData;
    if (['create', 'record', 'derive'].includes(command)) {
      const raw = await inputJson(flags.input); insist(!Object.keys(raw).some(key => ['id', 'op', 'revision'].includes(key)), 'invalid_input', 'Use explicit identity and revision flags');
      const op = scalar(flags.op); const revision = command === 'create' ? undefined : scalar(flags.revision);
      fitEnvelope(host, envelope({ owner_id: id, revision: 'f'.repeat(64), operation_id: op, replayed: false, attempts: 3, result: { kind: 'create', identity: 'x'.repeat(96), sequence: 256, digest: 'f'.repeat(64) }, result_digest: 'f'.repeat(64), outcome: 'committed' }), budget);
      if (command === 'create') data = await createQuantitySet(host, parse(CreateQuantitySetInputSchema, { ...raw, id, op }));
      else if (command === 'record') data = await recordQuantity(host, parse(RecordQuantityInputSchema, { ...raw, id, op, revision }));
      else data = await deriveQuantity(host, parse(DeriveQuantityInputSchema, { ...raw, id, op, revision }));
    } else if (command === 'convert') data = await convertQuantity(host, { id, quantity: scalar(flags.quantity), to: scalar(flags.to) } as Parameters<typeof convertQuantity>[1]);
    else if (command === 'compare') data = await compareQuantities(host, { id, left: scalar(flags.left), right: scalar(flags.right), across_windows: flags.acrossWindows as boolean | undefined });
    else if (command === 'explain') data = await explainQuantity(host, { id, quantity: scalar(flags.quantity) });
    else { insist(command === 'packet', 'invalid_input', 'Unknown unit command'); data = await quantityPacket(host, { id, quantity: flags.quantity === undefined ? undefined : scalar(flags.quantity), limit: integer(ctx.global.outputLimit ?? flags.limit, 20), cursor: flags.cursor === undefined ? ctx.global.outputCursor : scalar(flags.cursor) }); }
    return fitEnvelope(host, envelope(data), budget);
  } catch (error) { return fitEnvelope({ fitOutputEnvelope: ctx.sdk?.fitOutputEnvelope }, refusalEnvelope(refusal(error)), 1600); }
}
/** Register native schema, scoped renderers and commands without durable activation writes. */
export function register(api: ExtensionApi): void {
  api.registerItemTypes([{ name: 'QuantitySet', folder: 'quantities', description: 'Exact quantity context and derivations' }]);
  api.registerItemFields([{ name: 'unit_state', type: 'object', optional: true }]);
  const definitions = [
    ['create', [], ['id', 'input', 'op'], 'Create a caller-owned quantity set', 'pm unit create --id ledger --op birth --input -'],
    ['record', ['id'], ['input', 'op', 'revision'], 'Record an immutable exact observation', 'pm unit record ledger --op observation --revision <hash> --input -'],
    ['derive', ['id'], ['input', 'op', 'revision'], 'Persist a bounded exact binary derivation', 'pm unit derive ledger --op derivation --revision <hash> --input -'],
    ['convert', ['id'], ['quantity', 'to'], 'Convert without losing exact context', 'pm unit convert ledger --quantity elapsed --to min'],
    ['compare', ['id'], ['left', 'right'], 'Refuse incompatible meanings or populations', 'pm unit compare ledger --left elapsed --right summed'],
    ['explain', ['id'], ['quantity'], 'Retain complete dependency witnesses', 'pm unit explain ledger --quantity ratio'],
    ['packet', ['id'], ['quantity', 'limit', 'cursor'], 'Read a revision-bound quantity page', 'pm unit packet ledger --output-limit 10'],
  ] as const;
  for (const format of ['json', 'toon'] as const) api.registerRenderer(format, ctx => renderOutput(ctx.result, format).trimEnd(), { commands: definitions.map(([name]) => `unit ${name}`) });
  for (const [name, args, names, description, example] of definitions) {
    const flags: FlagDefinition[] = [...names, 'budget'].map(flag => ({ long: `--${flag}`, value_type: 'string', value_name: flag, description: `${flag}; ${example}` }));
    if (name === 'compare') flags.push({ long: '--across-windows', value_type: 'boolean', value_validation: 'strict', description: 'Compare the same subject, population, meaning and dimension across the explicitly named windows' });
    api.registerCommand(defineCommand({ ...(['convert', 'compare', 'explain', 'packet'].includes(name) ? { read_output: { row_keys: [] } } : {}), name: `unit ${name}`, description, intent: 'Preserve exact quantities and their declared population context', arguments: args.map(arg => ({ name: arg, required: true, description: 'Authorized quantity owner' })), flags, examples: [example], run: ctx => runCommand(name, ctx) }));
  }
}
