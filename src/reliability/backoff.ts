/**
 * Equal-jitter exponential backoff.
 * attempt 0 is the first retry. The delay is in [exp/2, exp], capped by maxMs.
 * random() is expected to return a value in [0, 1].
 */
export function computeBackoff(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attempt)
  const exp = Math.min(maxMs, baseMs * 2 ** exponent)
  const half = exp / 2
  const unit = Math.min(1, Math.max(0, random()))
  return Math.round(half + unit * half)
}
