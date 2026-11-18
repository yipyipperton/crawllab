import type { BrowserConfigView, FingerprintSignals } from '../../../src/shared/types'
import { useApi } from '../api'

type Payload = {
  observations: Array<{ id: string; configId: string; capturedAt: string; signals: FingerprintSignals }>
  latest: Record<string, { configId: string; signals: FingerprintSignals }>
  pairs: Array<{
    leftConfig: string
    rightConfig: string
    leftSignature: string
    rightSignature: string
    sameWebdriver: boolean
    diffCount: number
    diffs: { key: string; left: string; right: string }[]
  }>
  configs: BrowserConfigView[]
}

export function FingerprintsPage() {
  const { data, error, loading } = useApi<Payload>('/api/fingerprints', 0)
  const pair = data?.pairs[0]
  return (
    <>
      <header className="topbar">
        <div>
          <h2>Fingerprint lab</h2>
          <div className="muted">Two Playwright contexts against a local page. This view does not suggest hiding automation signals.</div>
        </div>
      </header>
      <div className="content">
        {error && <div className="error">{error}</div>}
        {loading && !data && <div className="muted">Loading observations…</div>}
        {data && data.observations.length === 0 && <div className="panel empty">No fingerprint runs yet. Seed the lab or run the Case B presets.</div>}
        {data && data.configs.length > 0 && (
          <div className="panel">
            <h3>Configurations under test</h3>
            <table className="data">
              <thead><tr><th>Id</th><th>User agent</th><th>Viewport</th><th>Locale</th><th>Timezone</th></tr></thead>
              <tbody>
                {data.configs.map((config) => (
                  <tr key={config.id}>
                    <td className="mono">{config.id}</td>
                    <td>{config.userAgent ?? 'Playwright default'}</td>
                    <td className="mono">{config.viewport.width}×{config.viewport.height}</td>
                    <td>{config.locale}</td>
                    <td>{config.timezoneId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pair && (
          <div className="panel">
            <h3>{pair.leftConfig} vs {pair.rightConfig}</h3>
            <p>
              {pair.diffCount} differing fields. webdriver {pair.sameWebdriver ? 'is the same on both' : 'differs'}.
              Signatures <span className="mono">{pair.leftSignature}</span> and <span className="mono">{pair.rightSignature}</span>.
            </p>
            <table className="data">
              <thead><tr><th>Signal</th><th>{pair.leftConfig}</th><th>{pair.rightConfig}</th></tr></thead>
              <tbody>
                {pair.diffs.map((diff) => (
                  <tr key={diff.key}>
                    <td className="mono">{diff.key}</td>
                    <td>{diff.left || '—'}</td>
                    <td>{diff.right || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && Object.keys(data.latest).length > 0 && (
          <div className="panel">
            <h3>Latest signals that stayed put</h3>
            <p className="muted">Shown for the first config so a matching webdriver bit is visible without reading the diff.</p>
            <pre className="pre">{JSON.stringify(data.latest[Object.keys(data.latest)[0] ?? '']?.signals.webdriver, null, 2)}</pre>
            <div className="muted">webdriver values: {Object.entries(data.latest).map(([config, observation]) => `${config}=${String(observation.signals.webdriver)}`).join(', ')}</div>
          </div>
        )}
      </div>
    </>
  )
}
