import fs from 'node:fs'
import path from 'node:path'

const FILES = [
  { id: 'A', file: 'docs/case-studies/A-async-render.md' },
  { id: 'B', file: 'docs/case-studies/B-fingerprint.md' },
  { id: 'C', file: 'docs/case-studies/C-fleet.md' },
  { id: 'RE', file: 'docs/reverse-engineering/case-study.md' },
]

export type CaseDocument = {
  id: string
  title: string
  summary: string
  markdown: string
}

function parseFrontmatter(text: string): { title: string; summary: string; body: string } {
  if (!text.startsWith('---\n')) return { title: 'Untitled', summary: '', body: text }
  const end = text.indexOf('\n---\n', 4)
  if (end === -1) return { title: 'Untitled', summary: '', body: text }
  const raw = text.slice(4, end)
  const body = text.slice(end + 5)
  const values: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const index = line.indexOf(':')
    if (index === -1) continue
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return { title: values.title ?? 'Untitled', summary: values.summary ?? '', body }
}

export function listCaseDocuments(): CaseDocument[] {
  return FILES.map((item) => {
    const text = fs.readFileSync(path.resolve(item.file), 'utf8')
    const parsed = parseFrontmatter(text)
    return { id: item.id, title: parsed.title, summary: parsed.summary, markdown: parsed.body }
  })
}

export function getCaseDocument(id: string): CaseDocument | null {
  return listCaseDocuments().find((item) => item.id === id) ?? null
}
