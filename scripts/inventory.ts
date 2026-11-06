import { readdirSync } from 'node:fs';
/** Inventory every authored runtime module, including future nested source directories. */
export function runtimeSources(): string[] {
  return ['index.ts', ...readdirSync('src',{recursive:true}).map(String).filter(name=>name.endsWith('.ts')&&!name.endsWith('.d.ts')).map(name=>`src/${name}`)];
}
