import { Link, useParams } from 'react-router-dom'
import { useApi } from '../api'
import { renderMarkdown } from '../format'

type CaseList = { id: string; title: string; summary: string }
type CaseDoc = CaseList & { markdown: string }

export function CasesPage() {
  const { id } = useParams()
  const list = useApi<CaseList[]>('/api/cases', 0)
  const doc = useApi<CaseDoc>(id ? `/api/cases/${id}` : null, 0)
  return (
    <>
      <header className="topbar">
        <h2>Case studies</h2>
      </header>
      <div className="content">
        {list.error && <div className="error">{list.error}</div>}
        <div className="grid-2">
          <div className="panel">
            {list.data?.map((item) => (
              <article key={item.id} className="finding">
                <h4><Link to={`/cases/${item.id}`}>{item.id}. {item.title}</Link></h4>
                <p className="muted">{item.summary}</p>
              </article>
            ))}
            {list.data && list.data.length === 0 && <div className="empty">Case studies are not in the working tree.</div>}
          </div>
          <div className="panel md">
            {!id && <div className="empty">Select a study. Measured tables are written by the seed script.</div>}
            {doc.error && <div className="error">{doc.error}</div>}
            {doc.data && <div dangerouslySetInnerHTML={{ __html: renderMarkdown(`# ${doc.data.title}\n\n${doc.data.markdown}`) }} />}
          </div>
        </div>
      </div>
    </>
  )
}
