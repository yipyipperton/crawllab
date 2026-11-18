import { useMemo, useState } from 'react'
import type { RunRecord } from '../../../src/shared/types'
import { useApi } from '../api'
import { RunTable } from './Overview'

export function RunsPage() {
  const [status, setStatus] = useState('')
  const [experimentId, setExperimentId] = useState('')
  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: '100' })
    if (status) params.set('status', status)
    if (experimentId) params.set('experimentId', experimentId)
    return `/api/runs?${params.toString()}`
  }, [status, experimentId])
  const { data, error, loading } = useApi<{ runs: RunRecord[]; total: number }>(query, 4000)

  return (
    <>
      <header className="topbar">
        <h2>Runs</h2>
        <div className="muted">{data ? `${data.total} matching` : ''}</div>
      </header>
      <div className="content">
        <div className="row">
          {['', 'success', 'failed', 'error', 'running'].map((value) => (
            <button key={value || 'all'} className={`btn${status === value ? ' primary' : ''}`} onClick={() => setStatus(value)}>
              {value || 'all'}
            </button>
          ))}
          <select className="select" value={experimentId} onChange={(event) => setExperimentId(event.target.value)}>
            <option value="">All experiments</option>
            {['case-a', 'case-b', 'case-c', 'case-re', 'diagnostics'].map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </div>
        {error && <div className="error">{error}</div>}
        {loading && !data && <div className="muted">Loading runs…</div>}
        {data && (
          <div className="panel">
            <RunTable runs={data.runs} />
          </div>
        )}
      </div>
    </>
  )
}
