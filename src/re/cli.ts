import fs from 'node:fs'
import path from 'node:path'
import { buildGateReport } from './report.js'

const report = buildGateReport()
const destination = path.resolve('docs/reverse-engineering/generated-report.md')
fs.mkdirSync(path.dirname(destination), { recursive: true })
fs.writeFileSync(destination, report.markdown)
console.log(
  JSON.stringify(
    {
      wrote: destination,
      folded: report.analysis.foldedCalls,
      modes: report.simulations.map((row) => ({
        webdriver: row.webdriver,
        token: row.token,
        mode: row.mode,
        text: row.text,
      })),
    },
    null,
    2,
  ),
)
