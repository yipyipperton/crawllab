/** Pure fixture policies so the lab server and the tests share one definition. */

export const FLAKE_MODULUS = 4
export const RATE_WINDOW_MS = 5_000
export const RATE_MAX = 2
export const OVERLOAD_LIMIT = 2
export const OVERLOAD_FAST_MS = 1_500
export const OVERLOAD_SLOW_MS = 4_500

export function flakeDecision(seq: number): 'ok' | 'fail' {
  return seq % FLAKE_MODULUS === 0 ? 'fail' : 'ok'
}

export function slidingWindowAllow(
  timestamps: number[],
  now: number,
  windowMs = RATE_WINDOW_MS,
  max = RATE_MAX,
): { allow: boolean; next: number[] } {
  const next = timestamps.filter((stamp) => now - stamp < windowMs)
  if (next.length >= max) return { allow: false, next }
  next.push(now)
  return { allow: true, next }
}
