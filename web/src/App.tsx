import { NavLink, Route, Routes } from 'react-router-dom'
import { CasesPage } from './pages/Cases'
import { ExperimentsPage } from './pages/Experiments'
import { FingerprintsPage } from './pages/Fingerprints'
import { OverviewPage } from './pages/Overview'
import { ResearchPage } from './pages/Research'
import { RunDetailPage } from './pages/RunDetail'
import { RunsPage } from './pages/Runs'

const links = [
  ['/', 'Overview'],
  ['/runs', 'Runs'],
  ['/experiments', 'Experiments'],
  ['/fingerprints', 'Fingerprints'],
  ['/research', 'Research'],
  ['/cases', 'Case studies'],
]

export function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C</div>
          <div>
            <h1>CrawlLab</h1>
            <p>Reliability lab</p>
          </div>
        </div>
        <nav>
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/:id" element={<RunDetailPage />} />
          <Route path="/experiments" element={<ExperimentsPage />} />
          <Route path="/fingerprints" element={<FingerprintsPage />} />
          <Route path="/research" element={<ResearchPage />} />
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/cases/:id" element={<CasesPage />} />
        </Routes>
      </div>
    </div>
  )
}
