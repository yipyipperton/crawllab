import { useApi } from '../api'

type Report = {
  analysis: {
    minifiedBytes: number
    foldedCalls: string[]
    stringTables: { name: string; values: string[] }[]
    browserApis: string[]
    conditions: string[]
    limits: string[]
    minified: string
  }
  simulations: { webdriver: string; token: boolean; mode: string | null; text: string | null; error: string | null }[]
}

export function ResearchPage() {
  const { data, error, loading } = useApi<Report>('/api/research/gate', 0)
  return (
    <>
      <header className="topbar">
        <div>
          <h2>Gate script</h2>
          <div className="muted">Static analysis plus a node:vm mock. The full branch is not reproduced in Chromium.</div>
        </div>
      </header>
      <div className="content">
        {error && <div className="error">{error}</div>}
        {loading && !data && <div className="muted">Analyzing fixture…</div>}
        {data && (
          <>
            <section className="grid-2">
              <div className="panel">
                <h3>Folded strings</h3>
                <p className="mono">{data.analysis.foldedCalls.join(', ') || 'none'}</p>
                <h3>String table</h3>
                <ul>
                  {data.analysis.stringTables[0]?.values.map((value, index) => (
                    <li key={value}><span className="mono">[{index}]</span> {value}</li>
                  ))}
                </ul>
                <h3>Limits</h3>
                <ul>{data.analysis.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul>
              </div>
              <div className="panel">
                <h3>Sandbox matrix</h3>
                <table className="data">
                  <thead><tr><th>webdriver</th><th>token</th><th>mode</th><th>text</th></tr></thead>
                  <tbody>
                    {data.simulations.map((row) => (
                      <tr key={`${row.webdriver}-${row.token}`}>
                        <td>{row.webdriver}</td>
                        <td>{row.token ? 'yes' : 'no'}</td>
                        <td>{row.mode ?? row.error}</td>
                        <td className="mono">{row.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <div className="panel">
              <h3>Browser-shaped accesses recovered from the AST</h3>
              <pre className="pre">{data.analysis.browserApis.join('\n')}</pre>
            </div>
            <div className="panel">
              <h3>Minified input ({data.analysis.minifiedBytes} bytes)</h3>
              <pre className="pre">{data.analysis.minified}</pre>
            </div>
          </>
        )}
      </div>
    </>
  )
}
