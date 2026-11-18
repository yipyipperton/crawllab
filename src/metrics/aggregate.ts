import type { MetricsSummary, RoleSummary, RunRecord, RunRole, VariantSummary } from '../shared/types.js'
import { average, percentile, roundTo } from '../util.js'

function rate(successes: number, samples: number): number | null {
  if (samples === 0) return null
  return roundTo((successes / samples) * 100, 1)
}

function latencyOf(runs: RunRecord[]): { avg: number | null; p95: number | null } {
  const values = runs
    .map((run) => run.durationMs)
    .filter((value): value is number => typeof value === 'number')
  return {
    avg: roundTo(average(values), 1),
    p95: roundTo(percentile(values, 95), 1),
  }
}

function categories(runs: RunRecord[]): { category: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const run of runs) {
    if (run.status !== 'failed' && run.status !== 'error') continue
    const category = run.status === 'error' ? 'worker_error' : run.diagnostics.primaryCategory || 'unclassified_failure'
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
}

export function summarizeRuns(runs: RunRecord[]): MetricsSummary {
  const finished = runs.filter((run) => run.status === 'success' || run.status === 'failed' || run.status === 'error')
  const successes = finished.filter((run) => run.status === 'success').length
  const failures = finished.filter((run) => run.status === 'failed').length
  const errors = finished.filter((run) => run.status === 'error').length
  const latency = latencyOf(finished)
  const roles = new Map<string, RunRecord[]>()
  const variants = new Map<string, RunRecord[]>()
  for (const run of finished) {
    const role = run.role ?? 'unscoped'
    roles.set(role, [...(roles.get(role) ?? []), run])
    if (run.experimentId && run.variant) {
      const key = `${run.experimentId}::${run.variant}`
      variants.set(key, [...(variants.get(key) ?? []), run])
    }
  }

  const byRole: RoleSummary[] = [...roles.entries()].map(([role, group]) => {
    const ok = group.filter((run) => run.status === 'success').length
    const numbers = latencyOf(group)
    return {
      role,
      samples: group.length,
      successes: ok,
      successRate: rate(ok, group.length),
      avgLatencyMs: numbers.avg,
      p95LatencyMs: numbers.p95,
    }
  })

  const variantSummaries: VariantSummary[] = [...variants.entries()].map(([key, group]) => {
    const [experimentId, variant] = key.split('::')
    const ok = group.filter((run) => run.status === 'success').length
    const numbers = latencyOf(group)
    const attempts = group.map((run) => run.attemptCount)
    return {
      experimentId: experimentId ?? '',
      variant: variant ?? '',
      role: (group[0]?.role ?? null) as RunRole | null,
      samples: group.length,
      successes: ok,
      failures: group.length - ok,
      successRate: rate(ok, group.length),
      avgLatencyMs: numbers.avg,
      p95LatencyMs: numbers.p95,
      avgAttempts: roundTo(average(attempts), 2),
      failureCategories: categories(group.filter((run) => run.status !== 'success')),
    }
  })
  variantSummaries.sort((a, b) => a.experimentId.localeCompare(b.experimentId) || a.variant.localeCompare(b.variant))

  return {
    total: runs.length,
    successes,
    failures,
    errors,
    running: runs.filter((run) => run.status === 'queued' || run.status === 'running').length,
    successRate: rate(successes, finished.length),
    avgLatencyMs: latency.avg,
    p95LatencyMs: latency.p95,
    byCategory: categories(finished),
    byRole,
    variants: variantSummaries,
  }
}
