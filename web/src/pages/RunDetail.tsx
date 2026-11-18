import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { RunRecord } from '../../../src/shared/types'
import { useApi } from '../api'
import { ms, when } from '../format'

const terminal = new Set(['success', 'failed', 'error'])

export function RunDetailPage() {
  const { id } = useParams()
  const { data, error, loading } = useApi<RunRecord>(id ? `/api/runs/${id}` : null, 1500)
  const [tab, setTab] = useState<'findings' | 'network' | 'console' | 'attempts'>('findings')
  const [shotBroken, setShotBroken] = useState(false)

  return (
    <>
      <header className="topbar">
        <div>
          <h2>{data?.label ?? 'Run'}</h2>
          <div className="muted mono">{id}</div>
        </div>
        <Link to="/runs">All runs</Link>
      </header>
      <div className="content">
        {error && <div className="error">{error}</div>}
        {loading && !data && <div className="muted">Loading run…</div>}
        {data && (
          <>
            <section className="grid-4">
              <div className="panel stat"><div className="label">Status</div><div className="value"><span className={`badge ${data.status}`}>{data.status}</span></div><div className="hint">{when(data.finishedAt ?? data.createdAt)}</div></div>
              <div className="panel stat"><div className="label">Category</div><div className="value" style={{ fontSize: 18 }}>{data.diagnostics.primaryCategory}</div><div className="hint">{data.variant} · {data.role ?? 'unscoped'}</div></div>
              <div className="panel stat"><div className="label">Latency</div><div className="value">{ms(data.durationMs)}</div><div className="hint">nav {ms(data.navigationMs)} · extract {ms(data.extractionMs)}</div></div>
              <div className="panel stat"><div className="label">HTTP / attempts</div><div className="value">{data.httpStatus ?? '—'}</div><div className="hint">{data.attemptCount} attempt(s)</div></div>
            </section>
            <div className="panel">
              <h3>Objective</h3>
              <div className="mono" style={{ overflowWrap: 'anywhere' }}>{data.url}</div>
              {data.finalUrl && data.finalUrl !== data.url && <div className="muted">Final: {data.finalUrl}</div>}
              <p>{data.diagnostics.summary}</p>
              {data.extractedText && <pre className="pre">{data.extractedText}</pre>}
            </div>
            <div className="grid-2">
              <div className="panel">
                <div className="tabs">
                  {(['findings', 'network', 'console', 'attempts'] as const).map((name) => (
                    <button key={name} className={`btn${tab === name ? ' primary' : ''}`} onClick={() => setTab(name)}>{name}</button>
                  ))}
                </div>
                {tab === 'findings' && <Findings run={data} />}
                {tab === 'network' && <Network run={data} />}
                {tab === 'console' && <Console run={data} />}
                {tab === 'attempts' && <Attempts run={data} />}
              </div>
              <div className="panel">
                <h3>Artifacts</h3>
                {!terminal.has(data.status) && <div className="muted">Run still {data.status}.</div>}
                {data.hasScreenshot && !shotBroken ? (
                  <img className="shot" alt="Page screenshot" src={`/api/runs/${data.id}/screenshot`} onError={() => setShotBroken(true)} />
                ) : (
                  <div className="empty">No screenshot for this run.</div>
                )}
                {data.hasTrace && (
                  <p><a href={`/api/runs/${data.id}/trace`}>Download trace zip</a></p>
                )}
                {data.hasTrace && <p className="muted">Open it with <code>npx playwright show-trace &lt;file&gt;</code>.</p>}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

function Findings({ run }: { run: RunRecord }) {
  if (run.diagnostics.findings.length === 0) return <div className="empty">No findings.</div>
  return (
    <div>
      {run.diagnostics.findings.map((finding) => (
        <article key={`${finding.code}-${finding.title}`} className="finding">
          <div className="row">
            <h4>{finding.title}</h4>
            <span className={`badge ${finding.severity}`}>{finding.severity}</span>
            <span className={`badge ${finding.confidence}`}>{finding.confidence}</span>
            <span className="mono muted">{finding.code}</span>
          </div>
          <p>{finding.probableCause}</p>
          <ul>{finding.investigation.map((step) => <li key={step}>{step}</li>)}</ul>
          {finding.evidence.length > 0 && (
            <pre className="pre">{finding.evidence.map((item) => `${item.source}: ${item.detail}`).join('\n')}</pre>
          )}
        </article>
      ))}
    </div>
  )
}

function Network({ run }: { run: RunRecord }) {
  const requests = run.evidence?.requests ?? []
  if (requests.length === 0) return <div className="empty">No requests captured.</div>
  return (
    <table className="data">
      <thead><tr><th>Status</th><th>Type</th><th>Method</th><th>URL</th></tr></thead>
      <tbody>
        {requests.slice(0, 60).map((request, index) => (
          <tr key={`${request.url}-${index}`}>
            <td className="mono">{request.failure ? request.failure : request.status ?? '—'}</td>
            <td>{request.resourceType}</td>
            <td>{request.method}</td>
            <td className="mono">{request.url}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Console({ run }: { run: RunRecord }) {
  const messages = run.evidence?.consoleMessages ?? []
  const errors = run.evidence?.pageErrors ?? []
  if (messages.length === 0 && errors.length === 0) return <div className="empty">No console or page errors.</div>
  return (
    <pre className="pre">
      {errors.map((error) => `pageerror: ${error}`).join('\n')}
      {errors.length ? '\n' : ''}
      {messages.map((message) => `${message.type}: ${message.text}`).join('\n')}
    </pre>
  )
}

function Attempts({ run }: { run: RunRecord }) {
  const attempts = run.evidence?.attempts ?? []
  if (attempts.length === 0) return <div className="empty">No attempt log.</div>
  return (
    <table className="data">
      <thead><tr><th>#</th><th>ms</th><th>HTTP</th><th>Timeout</th><th>Retryable</th><th>Error</th></tr></thead>
      <tbody>
        {attempts.map((attempt) => (
          <tr key={attempt.attempt}>
            <td>{attempt.attempt}</td>
            <td className="mono">{attempt.durationMs}</td>
            <td>{attempt.httpStatus ?? '—'}</td>
            <td>{attempt.timedOut ? 'yes' : 'no'}</td>
            <td>{attempt.retryable ? 'yes' : 'no'}</td>
            <td>{attempt.error ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
