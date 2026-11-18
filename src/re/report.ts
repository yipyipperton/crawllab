import fs from 'node:fs'
import path from 'node:path'
import { analyzeScript, type ScriptAnalysis } from './analyze.js'
import { simulateMatrix, type GateSimulation } from './simulate.js'

export function loadGateSource(): string {
  return fs.readFileSync(path.resolve('fixtures/js/gate.source.js'), 'utf8')
}

export function buildGateReport(source = loadGateSource()): {
  analysis: ScriptAnalysis
  simulations: GateSimulation[]
  markdown: string
} {
  const analysis = analyzeScript(source)
  const simulations = simulateMatrix(analysis.minified)
  const lines = [
    '# Generated gate-script report',
    '',
    'This file is produced by `npm run analyze:gate`. It is the output of the static analysis and the node:vm simulation. It is not a browser evasion procedure.',
    '',
    `Minified size: ${analysis.minifiedBytes} bytes.`,
    '',
    '## Constant folding',
    '',
    `Concatenators: ${analysis.concatenators.join(', ') || 'none'}.`,
    `Folded strings: ${analysis.foldedCalls.join(', ') || 'none'}.`,
    '',
    '## String table',
    '',
    ...analysis.stringTables.flatMap((table) => [
      `Table \`${table.name}\`:`,
      '',
      ...table.values.map((value, index) => `- [${index}] ${value}`),
      '',
    ]),
    '## Browser-shaped accesses',
    '',
    ...analysis.browserApis.map((value) => `- \`${value}\``),
    '',
    '## Conditions (sliced from the minified source)',
    '',
    ...analysis.conditions.map((value) => `- \`${value}\``),
    '',
    '## Sandbox matrix',
    '',
    'The simulator mocks `navigator` inside `node:vm`. It does not launch Chromium and does not change `navigator.webdriver` in a real browser.',
    '',
    '| webdriver | token | mode | text |',
    '| --- | --- | --- | --- |',
    ...simulations.map(
      (row) => `| ${row.webdriver} | ${row.token ? 'yes' : 'no'} | ${row.mode ?? row.error ?? 'n/a'} | ${row.text ?? ''} |`,
    ),
    '',
    '## Limits',
    '',
    ...analysis.limits.map((value) => `- ${value}`),
    '',
    '## Minified input',
    '',
    '```js',
    analysis.minified,
    '```',
    '',
  ]
  return { analysis, simulations, markdown: lines.join('\n') }
}
