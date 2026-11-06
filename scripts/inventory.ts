import { readdirSync } from 'node:fs';
import { join } from 'node:path';
/** Inventory every authored runtime module, including future nested source directories. */
export function runtimeSources(root = process.cwd()): string[] {
  return ['index.ts', ...readdirSync(join(root, 'src'),{recursive:true}).map(String).filter(name=>name.endsWith('.ts')&&!name.endsWith('.d.ts')).map(name=>`src/${name}`)];
}
