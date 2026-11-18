export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${value.toFixed(1)}%`
}

export function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${Math.round(value)} ms`
}

export function when(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().replace('T', ' ').slice(0, 19)
}

export function renderMarkdown(source: string): string {
  const escaped = source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const blocks = escaped.split(/```/)
  const rendered = blocks.map((block, index) => {
    if (index % 2 === 1) return `<pre class="pre">${block.replace(/^\w+\n/, '')}</pre>`
    const lines = block.split('\n')
    const html: string[] = []
    let list: string[] = []
    let table: string[] = []
    const flushList = () => {
      if (!list.length) return
      html.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`)
      list = []
    }
    const flushTable = () => {
      if (!table.length) return
      const rows = table.filter((row) => !/^\s*\|?\s*-+/.test(row.replace(/\|/g, '').trim()) && !row.includes('---'))
      const parsed = rows.map((row) => row.split('|').slice(1, -1).map((cell) => cell.trim()))
      if (parsed.length) {
        const head = parsed[0] ?? []
        const body = parsed.slice(1)
        html.push(
          `<table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${body
            .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`,
        )
      }
      table = []
    }
    for (const line of lines) {
      if (line.trim().startsWith('|')) {
        flushList()
        table.push(line)
        continue
      }
      flushTable()
      if (line.startsWith('- ')) {
        list.push(line.slice(2))
        continue
      }
      flushList()
      if (line.startsWith('### ')) html.push(`<h3>${inline(line.slice(4))}</h3>`)
      else if (line.startsWith('## ')) html.push(`<h2>${inline(line.slice(3))}</h2>`)
      else if (line.startsWith('# ')) html.push(`<h1>${inline(line.slice(2))}</h1>`)
      else if (line.trim()) html.push(`<p>${inline(line)}</p>`)
    }
    flushList()
    flushTable()
    return html.join('')
  })
  return rendered.join('')
}

function inline(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}
