/**
 * Splits `total` (in whole currency units, e.g. pounds) across the given
 * weights (fractions summing to ~1) so the results sum back to EXACTLY
 * `total` to the penny. A naive `total * weight` per line will not do
 * this — rounding each line independently drops or gains pennies. Uses
 * largest-remainder allocation: floor every line to the penny, then hand
 * the leftover pennies to the lines with the biggest fractional remainder
 * first.
 *
 * Flagged explicitly in the testing-strategy scoping answer (Addendum
 * 2.O) as needing a real, tested rounding rule — this is that rule.
 */
export function allocateAmounts(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];

  const totalCents = Math.round(total * 100);
  const rawCents = weights.map((w) => w * totalCents);
  const flooredCents = rawCents.map(Math.floor);
  const allocatedCents = flooredCents.reduce((a, b) => a + b, 0);
  const remainderCents = totalCents - allocatedCents;

  const byRemainderDesc = rawCents
    .map((v, i) => ({ i, frac: v - flooredCents[i] }))
    .sort((a, b) => b.frac - a.frac);

  const resultCents = [...flooredCents];
  for (let k = 0; k < remainderCents; k++) {
    resultCents[byRemainderDesc[k % byRemainderDesc.length].i] += 1;
  }

  return resultCents.map((c) => c / 100);
}
