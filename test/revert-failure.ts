/** Read error identity from Node's TAP diagnostics, excluding test names and logged output. */
export function isBehavioralRevertFailure(output: string): boolean {
  for (const [, indent, details] of output.matchAll(/^( +)---\r?\n([\s\S]*?)^\1\.\.\.\r?$/gm)) {
    const fields = details.split(/\r?\n/);
    if (!fields.includes(indent + "failureType: 'testCodeFailure'")) continue;
    if (fields.includes(indent + "code: 'ERR_ASSERTION'") || fields.includes(indent + "name: 'UnitRefusal'")) return true;
  }
  return false;
}
