import type { ExperimentNote, VariantSummary } from '../../../src/shared/types'
import { useApi } from '../api'
import { ms, pct } from '../format'

export function ExperimentsPage() {
  const { data, error, loading } = useApi<{ variants: VariantSummary[]; notes: ExperimentNote[] }>('/api/experiments', 5000)
  const groups = [...new Set(data?.variants.map((variant) => variant.experimentId) ?? [])]
  return (
    <>
      <header className="topbar">
        <div>
          <h2>Experiments</h2>
          <div className="muted">Each row is a batch from <code>npm run seed</code> or later preset runs with the same ids.</div>
        </div>
      </header>
      <div className="content">
        {error && <div className="error">{error}</div>}
        {loading && !data && <div className="muted">Loading experiments…</div>}
        {data && data.variants.length === 0 && <div className="panel empty">No experiment runs stored.</div>}
        {groups.map((group) => (
          <div className="panel" key={group}>
            <h3>{group}</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Variant</th><th>Role</th><th>Samples</th><th>Success</th><th>Avg</th><th>p95</th><th>Attempts</th><th>Failures</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.variants.filter((variant) => variant.experimentId === group).map((variant) => (
                    <tr key={`${variant.experimentId}-${variant.variant}`}>
                      <td className="mono">{variant.variant}</td>
                      <td><span className="badge">{variant.role}</span></td>
                      <td>{variant.samples}</td>
                      <td className="mono">{pct(variant.successRate)}</td>
                      <td className="mono">{ms(variant.avgLatencyMs)}</td>
                      <td className="mono">{ms(variant.p95LatencyMs)}</td>
                      <td className="mono">{variant.avgAttempts ?? '—'}</td>
                      <td className="muted">{variant.failureCategories.map((item) => `${item.category} (${item.count})`).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {data && data.notes.length > 0 && (
          <div className="panel">
            <h3>Fixture counters captured with each batch</h3>
            <p className="muted">These counts come from the fixture process during the seed, not from a hand-written table.</p>
            <table className="data">
              <thead><tr><th>Batch</th><th>Concurrency</th><th>Server counters</th></tr></thead>
              <tbody>
                {data.notes.map((note) => (
                  <tr key={note.id}>
                    <td className="mono">{note.experimentId}/{note.variant}</td>
                    <td>{String(note.body.concurrency ?? '—')}</td>
                    <td className="mono">{JSON.stringify(note.body.fixtureStats ?? {})}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
