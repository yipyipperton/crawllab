import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { BrowserConfigView, MetricsSummary, PresetView, RunRecord } from '../../../src/shared/types'
import { useApi } from '../api'
import { ms, pct, when } from '../format'

type Overview = {
  metrics: MetricsSummary
  recent: RunRecord[]
  meta: { generatedAt?: string; runCount?: number; node?: string; playwright?: string; browserChannel?: string } | null
  presets: PresetView[]
  configs: BrowserConfigView[]
}

export function OverviewPage() {
  const { data, error, loading } = useApi<Overview>('/api/overview', 4000)
  return (
    <>
      <header className="topbar">
        <div>
          <h2>Overview</h2>
          <div className="muted">Metrics are computed from stored runs. Baselines are supposed to fail.</div>
        </div>
        <div className="muted">{data?.meta?.generatedAt ? `Seeded ${when(data.meta.generatedAt)}` : 'No seed metadata yet'}</div>
      </header>
      <div className="content">
        {error && <div className="error">API error: {error}</div>}
        {loading && !data && <div className="muted">Loading runs…</div>}
        {data && data.metrics.total === 0 && (
          <div className="panel empty">No runs yet. Start a preset below, or run <code>npm run seed</code> to fill the lab from the local fixtures.</div>
        )}
        {data && (
          <>
            <section className="grid-4">
              <Stat label="Stored runs" value={String(data.metrics.total)} hint={`${data.metrics.running} in flight`} />
              <Stat label="Successes / failures" value={`${data.metrics.successes} / ${data.metrics.failures + data.metrics.errors}`} hint="Finished runs only in the rate" />
              <Stat label="Success rate" value={pct(data.metrics.successRate)} hint="Includes intentional failing baselines" />
              <Stat label="Latency avg / p95" value={`${ms(data.metrics.avgLatencyMs)} / ${ms(data.metrics.p95LatencyMs)}`} hint="Wall time, failures included" />
            </section>
            <section className="grid-4">
              {data.metrics.byRole.map((role) => (
                <Stat key={role.role} label={`${role.role} success`} value={pct(role.successRate)} hint={`${role.successes}/${role.samples} · p95 ${ms(role.p95LatencyMs)}`} />
              ))}
            </section>
            <section className="grid-2">
              <div className="panel">
                <h3>Failure categories</h3>
                {data.metrics.byCategory.length === 0 && <div className="empty">No failed runs.</div>}
                <Bars items={data.metrics.byCategory.map((item) => ({ label: item.category, value: item.count }))} />
              </div>
              <Launcher presets={data.presets} />
            </section>
            <div className="panel">
              <h3>Recent runs</h3>
              <RunTable runs={data.recent} />
            </div>
          </>
        )}
      </div>
    </>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="panel stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="hint">{hint}</div>
    </div>
  )
}

export function Bars({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((item) => item.value))
  return (
    <div>
      {items.map((item) => (
        <div className="bar" key={item.label}>
          <div className="name" title={item.label}>{item.label}</div>
          <div className="track"><div className="fill" style={{ width: `${(item.value / max) * 100}%` }} /></div>
          <div className="mono">{item.value}</div>
        </div>
      ))}
    </div>
  )
}

export function RunTable({ runs }: { runs: RunRecord[] }) {
  if (runs.length === 0) return <div className="empty">No runs match.</div>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data">
        <thead>
          <tr>
            <th>When</th>
            <th>Status</th>
            <th>Experiment</th>
            <th>Category</th>
            <th>Latency</th>
            <th>Attempts</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td className="mono"><Link to={`/runs/${run.id}`}>{when(run.createdAt)}</Link></td>
              <td><span className={`badge ${run.status}`}>{run.status}</span></td>
              <td>{run.experimentId ?? '—'} <span className="muted">{run.variant}</span></td>
              <td className="mono">{run.diagnostics.primaryCategory}</td>
              <td className="mono">{ms(run.durationMs)}</td>
              <td className="mono">{run.attemptCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Launcher({ presets }: { presets: PresetView[] }) {
  const groups = [...new Set(presets.map((preset) => preset.group))]
  const [presetId, setPresetId] = useState(presets[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selected = presets.find((preset) => preset.id === presetId)

  async function launch() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preset: presetId }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? response.statusText)
      setMessage(body.run.id as string)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <h3>Run a preset</h3>
      <p className="muted">Presets only target the local fixture server. Nothing here changes webdriver or bypasses a challenge.</p>
      <div className="row">
        <select className="select" value={presetId} onChange={(event) => setPresetId(event.target.value)}>
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {presets.filter((preset) => preset.group === group).map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <button className="btn primary" disabled={busy || !presetId} onClick={() => void launch()}>
          {busy ? 'Queuing…' : 'Run'}
        </button>
      </div>
      {selected && <p className="muted">{selected.description}</p>}
      {message && <p>Queued <Link to={`/runs/${message}`}>{message}</Link></p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
