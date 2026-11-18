import { createHash } from 'node:crypto'
import type { FingerprintSignals } from '../shared/types.js'

const SIGNATURE_KEYS = [
  'userAgent',
  'webdriver',
  'language',
  'platform',
  'timezone',
  'viewport.innerWidth',
  'viewport.innerHeight',
  'headlessTokenInUa',
]

export function flattenSignals(value: unknown, prefix = ''): Record<string, string> {
  if (value === null || value === undefined) return prefix ? { [prefix]: '' } : {}
  if (typeof value !== 'object') return { [prefix || 'value']: String(value) }
  if (Array.isArray(value)) return { [prefix || 'value']: value.map((item) => String(item)).join(',') }
  const out: Record<string, string> = {}
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      Object.assign(out, flattenSignals(child, next))
    } else if (Array.isArray(child)) {
      out[next] = child.map((item) => String(item)).join(',')
    } else if (child === null || child === undefined) {
      out[next] = ''
    } else {
      out[next] = String(child)
    }
  }
  return out
}

export function signature(signals: FingerprintSignals): string {
  const flat = flattenSignals(signals)
  const canonical = SIGNATURE_KEYS.map((key) => `${key}=${flat[key] ?? ''}`).join('\n')
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12)
}

export function diffSignals(
  left: FingerprintSignals,
  right: FingerprintSignals,
): { key: string; left: string; right: string }[] {
  const a = flattenSignals(left)
  const b = flattenSignals(right)
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  const diffs = []
  for (const key of keys) {
    if ((a[key] ?? '') !== (b[key] ?? '')) {
      diffs.push({ key, left: a[key] ?? '', right: b[key] ?? '' })
    }
  }
  return diffs
}

export type FingerprintObservation = {
  id: string
  runId: string
  configId: string
  capturedAt: string
  signals: FingerprintSignals
}

export function compareObservations(observations: FingerprintObservation[]): {
  latest: Record<string, FingerprintObservation>
  pairs: Array<{
    leftConfig: string
    rightConfig: string
    leftSignature: string
    rightSignature: string
    sameWebdriver: boolean
    diffCount: number
    diffs: { key: string; left: string; right: string }[]
  }>
} {
  const latest: Record<string, FingerprintObservation> = {}
  for (const observation of observations) {
    const current = latest[observation.configId]
    if (!current || observation.capturedAt > current.capturedAt) latest[observation.configId] = observation
  }
  const configs = Object.keys(latest).sort()
  const pairs = []
  for (let i = 0; i < configs.length; i += 1) {
    for (let j = i + 1; j < configs.length; j += 1) {
      const leftConfig = configs[i] ?? ''
      const rightConfig = configs[j] ?? ''
      const left = latest[leftConfig]
      const right = latest[rightConfig]
      if (!left || !right) continue
      const diffs = diffSignals(left.signals, right.signals)
      pairs.push({
        leftConfig,
        rightConfig,
        leftSignature: signature(left.signals),
        rightSignature: signature(right.signals),
        sameWebdriver: left.signals.webdriver === right.signals.webdriver,
        diffCount: diffs.length,
        diffs,
      })
    }
  }
  return { latest, pairs }
}
