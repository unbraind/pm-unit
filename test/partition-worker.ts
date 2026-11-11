/** Separate OS caller pauses at a real native mutation boundary for race/crash tests. */
import { createDirectoryHost, declarePartition } from '../dist/index.js';
import type { DeclarePartitionInput } from '../dist/index.js';

const host = createDirectoryHost(process.argv[2], 'partition-worker');
const input = JSON.parse(process.argv[3]) as DeclarePartitionInput;
host.boundary = async step => {
  if (step === process.argv[4]) {
    const resumed = new Promise<void>(resolve => { process.once('message', () => resolve()); });
    process.send!({ ready: step }); await resumed;
  }
};
try { const receipt = await declarePartition(host, input); process.send!({ outcome: 'committed', receipt }); }
catch (error) { process.send!({ outcome: 'refused', code: (error as { code: string }).code }); }
process.disconnect!();
