import { writeFile } from 'node:fs/promises';
import { harvest, evaluateCorpus } from './corpus.ts';
if (process.argv.includes('--refresh')) await harvest();
const receipt = await evaluateCorpus(); await writeFile('real-data.local.json', JSON.stringify(receipt, null, 2) + '\n');
if (process.argv.includes('--write-receipt')) await writeFile('docs/real-data-receipt.json', JSON.stringify(receipt, null, 2) + '\n');
const { results, sources, emitted_inventory, external_source_anchors, ...summary } = receipt; console.log(JSON.stringify({ ...summary, result_count: results.length, source_count: sources.length, emitted_files: emitted_inventory.length, native_external_anchors: external_source_anchors.length }, null, 2));
