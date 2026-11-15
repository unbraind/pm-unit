/** Scale only harness watchdogs; product deadlines keep their original values. */
export function testTimeout(milliseconds: number): number {
  const scale = Number(process.env.PM_TEST_TIME_SCALE ?? '1');
  if (!Number.isFinite(scale) || scale <= 0 || milliseconds * scale > 2_147_483_647) throw new Error('Invalid PM_TEST_TIME_SCALE');
  return Math.ceil(milliseconds * scale);
}
