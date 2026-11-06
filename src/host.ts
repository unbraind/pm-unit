import { PmClient, normalizeItemId } from '@unbrained/pm-cli/sdk/core';
import { readSettings, fitOutputEnvelope } from '@unbrained/pm-cli/sdk';
import type { QuantitySet } from './schema.ts';
import { insist } from './errors.ts';

/** Host-owned capability evidence; method presence alone is insufficient. */
export interface Host {
  /** Already authorized native item lifecycle port; backend selection stays host-owned. */
  client: Pick<PmClient, 'get' | 'create' | 'update' | 'readItemRevision' | 'withExpectedItemRevisions' | 'listAllComplete'>;
  /** Conformance assertion supplied by the embedding host. */
  capabilities: { native_item_cas: boolean; create_if_absent: boolean; provider: string };
  /** Host-pinned whole-envelope fitter. */
  fitOutputEnvelope?: typeof fitOutputEnvelope;
  /** Read-only package settings; activation and reads never migrate them. */
  settings?: () => Promise<unknown>;
  /** Normalize native identities using the backend-owned prefix policy. */
  normalizeId?: (id: string) => Promise<string>;
  /** Explicit create-time schema provisioning for directory SDK consumers. */
  prepareCreate?: () => Promise<void>;
  /** Optional observability/crash boundary; never authoritative state. */
  boundary?: (step: string) => Promise<void>;
}
/** Refuse unsupported providers before attempting any storage access. */
export function capable(host: Host): void {
  insist(host.capabilities.native_item_cas && host.capabilities.create_if_absent, 'backend_unsupported', 'Host lacks certified native CAS or create-if-absent', 'Select a conforming authorized host; backend ports are tracked upstream in pm-cli issues 1399, 1587 and 1588');
}
/** Bind a directory tracker through the public SDK; no runtime git dependency. */
export function createDirectoryHost(pmRoot: string, author: string): Host {
  const client = new PmClient({ cwd: pmRoot, pmRoot, author, noExtensions: false });
  const port = persistedSchemaPort(client, true);
  return { client: port, capabilities: { native_item_cas: true, create_if_absent: true, provider: 'directory' }, fitOutputEnvelope,
    /** Normalize owner identities using the backend SDK prefix policy. */
    normalizeId: async id => normalizeItemId(id, (await readSettings(pmRoot)).id_prefix),
    /** Read package-owned policy without changing native tracker settings. */
    settings: async () => (await readSettings(pmRoot) as unknown as Record<string, unknown>).unit,
    /** Register missing native schema only for explicit creation; never replace peer definitions. */
    prepareCreate: async () => {
      const fields = await client.schemaListFields(); const existing = fields.fields.find(field => field.key === 'unit_state');
      const registry = await client.schemaList(); const type = [...registry.builtin, ...registry.custom, ...registry.extension].find(entry => entry.name === 'QuantitySet');
      if (existing) insist(existing.type === 'object', 'invalid_record', 'unit_state belongs to an incompatible schema');
      if (type) insist(type.folder === 'quantities', 'invalid_record', 'QuantitySet belongs to an incompatible type registration');
      if (!existing) await client.schemaAddField('unit_state', { type: 'object', description: 'Versioned pm-unit owner state' });
      if (!type) await client.schemaAddType('QuantitySet', { folder: 'quantities', description: 'Exact quantities and populations' });
    },
  };
}
/** Full authorized owner snapshot and native immutable revision. */
export interface Snapshot {
  /** Canonical native identity. */
  id: string;
  /** Current canonical item hash. */
  revision: string;
  /** Strictly validated native custom field. */
  state: QuantitySet;
}

/** Translate the one extension-field assignment for a native persisted project-schema route. */
function nativeOptions<T extends { field?: string[] }>(options: T | undefined): Omit<T, 'field'> & { unitState?: unknown } {
  const { field, ...rest } = options ?? {} as T;
  if (field === undefined) return rest;
  insist(field.length === 1 && field[0].startsWith('unit_state='), 'invalid_input', 'Directory adapter only accepts its owned custom field');
  return { ...rest, unitState: JSON.parse(field[0].slice('unit_state='.length)) as unknown };
}

/** Adapt native project-schema routing while retaining the SDK client revision scope. */
export function persistedSchemaPort(client: PmClient, dynamic = false): Host['client'] {
  /** Select the native option route from actual project schema without provisioning on reads. */
  async function route<T extends { field?: string[] }>(options: T | undefined) {
    const usePersisted = !dynamic || (await client.schemaListFields()).fields.some(field => field.key === 'unit_state');
    return usePersisted ? nativeOptions(options) : options;
  }
  const port: Host['client'] = {
    get: client.get.bind(client), readItemRevision: client.readItemRevision.bind(client), withExpectedItemRevisions: client.withExpectedItemRevisions.bind(client), listAllComplete: client.listAllComplete.bind(client),
    /** Route a project-schema custom field through its declared SDK option. */
    create: async options => client.create(await route(options)),
    /** Preserve native locked update dispatch when using persisted directory schema. */
    update: async (id, options) => client.update(id, await route(options)),
  };
  return port;
}
