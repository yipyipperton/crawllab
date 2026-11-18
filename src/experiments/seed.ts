import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from '../config.js'
import { openDatabase } from '../db/database.js'
import { Repo } from '../db/repo.js'
import { getBrowserConfig } from '../engine/configs.js'
import { BrowserPool } from '../engine/pool.js'
import { createFixtureServer, type FixtureStats } from '../fixtures/server.js'
import { summarizeRuns } from '../metrics/aggregate.js'
import { compareObservations } from '../fingerprint/compare.js'
import { HostLimiter } from '../reliability/rate-limit.js'
import { TaskQueue } from '../reliability/queue.js'
import { buildGateReport } from '../re/report.js'
import { RunService } from '../service/run-service.js'
import type { RunRecord, VariantSummary } from '../shared/types.js'
import { batches, getPreset } from './catalog.js'

function fillMarker(file: string, name: string, body: string): void {
  const full = path.resolve(file)
  const text = fs.readFileSync(full, 'utf8')
  const start = `<!-- bench:${name} -->`
  const end = `<!-- /bench:${name} -->`
  const startIndex = text.indexOf(start)
  const endIndex = text.indexOf(end)
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`missing marker ${name} in ${file}`)
  }
  const next = `${text.slice(0, startIndex + start.length)}\n${body.trim()}\n${text.slice(endIndex)}`
  fs.writeFileSync(full, next)
}

function variantTable(rows: VariantSummary[]): string {
  const header = [
    '| Variant | Role | Samples | Successes | Success rate | Avg ms | p95 ms | Avg attempts | Failure categories |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ]
  const body = rows.map((row) => {
    const categories = row.failureCategories.map((item) => `${item.category} ${item.count}`).join(', ') || '—'
    return `| ${row.variant} | ${row.role ?? ''} | ${row.samples} | ${row.successes} | ${row.successRate ?? 'n/a'}% | ${row.avgLatencyMs ?? 'n/a'} | ${row.p95LatencyMs ?? 'n/a'} | ${row.avgAttempts ?? 'n/a'} | ${categories} |`
  })
  return [...header, ...body].join('\n')
}

function packageVersion(name: string): string {
  const file = path.resolve('node_modules', name, 'package.json')
  return JSON.parse(fs.readFileSync(file, 'utf8')).version as string
}

const config = loadConfig()
const fixture = await createFixtureServer(0)
const db = openDatabase(config.databasePath)
const repo = new Repo(db)
repo.resetAll()
const pool = new BrowserPool(config.browserChannel)
const service = new RunService(repo, pool, fixture.url, config)

try {
  await pool.withContext(getBrowserConfig('stock-headless'), async (context) => {
    const page = await context.newPage()
    await page.goto(`${fixture.url}/pages/static`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await page.close()
  })

  for (const batch of batches) {
    const preset = getPreset(batch.presetId)
    fixture.reset()
    const limiter = batch.rateLimit
      ? new HostLimiter(batch.rateLimit.capacity, batch.rateLimit.refillPerSecond)
      : null
    const queue = new TaskQueue(batch.concurrency)
    console.log(
      `[seed] ${preset.job.experimentId}/${preset.job.variant} x${batch.samples} concurrency=${batch.concurrency}`,
    )
    const runs: RunRecord[] = await Promise.all(
      Array.from({ length: batch.samples }, (_, index) =>
        queue.run(() =>
          service.execute(
            {
              ...preset.job,
              captureTrace: Boolean(batch.traceFirst && index === 0),
              captureScreenshot: preset.job.transport !== 'http',
            },
            limiter,
          ),
        ),
      ),
    )
    const stats: FixtureStats = JSON.parse(JSON.stringify(fixture.stats))
    for (const run of runs) {
      console.log(
        `  ${run.status.padEnd(7)} ${String(run.durationMs ?? '').padStart(6)}ms  attempts=${run.attemptCount}  ${run.diagnostics.primaryCategory}  ${run.variant}`,
      )
    }
    repo.insertNote(preset.job.experimentId ?? 'unscoped', preset.job.variant ?? batch.presetId, {
      presetId: batch.presetId,
      samples: batch.samples,
      concurrency: batch.concurrency,
      rateLimit: batch.rateLimit ?? null,
      fixtureStats: stats,
      runs: runs.map((run) => ({
        id: run.id,
        status: run.status,
        durationMs: run.durationMs,
        attempts: run.attemptCount,
        category: run.diagnostics.primaryCategory,
        httpStatus: run.httpStatus,
      })),
    })
  }

  const runs = repo.allRuns()
  const metrics = summarizeRuns(runs)
  const fingerprints = compareObservations(repo.listFingerprints())
  const report = buildGateReport()
  fs.mkdirSync('docs/reverse-engineering', { recursive: true })
  fs.writeFileSync('docs/reverse-engineering/generated-report.md', report.markdown)
  const generatedAt = new Date().toISOString()
  const benchmark = {
    generatedAt,
    command: 'npm run seed',
    node: process.version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cpuCount: os.cpus().length,
    playwright: packageVersion('playwright'),
    browserChannel: pool.channel,
    cdp: pool.versionInfo,
    metrics,
    fingerprintPairs: fingerprints.pairs,
    webdriverValues: Object.fromEntries(
      Object.entries(fingerprints.latest).map(([config, observation]) => [config, observation.signals.webdriver]),
    ),
    notes: repo.listNotes(),
  }
  fs.mkdirSync('results', { recursive: true })
  fs.writeFileSync('results/benchmarks.json', JSON.stringify(benchmark, null, 2))
  repo.setMeta('benchmark', {
    generatedAt,
    command: benchmark.command,
    node: benchmark.node,
    platform: benchmark.platform,
    cpu: benchmark.cpu,
    cpuCount: benchmark.cpuCount,
    playwright: benchmark.playwright,
    browserChannel: benchmark.browserChannel,
    cdp: benchmark.cdp,
    runCount: runs.length,
  })

  const envLine = [
    `Generated ${generatedAt} by \`npm run seed\`.`,
    `Node ${benchmark.node}, ${benchmark.platform}, ${benchmark.cpuCount}× ${benchmark.cpu}.`,
    `Playwright ${benchmark.playwright}, browser channel \`${benchmark.browserChannel}\`, CDP ${benchmark.cdp?.product ?? 'n/a'}.`,
  ].join(' ')

  const section = (experimentId: string) =>
    `${envLine}\n\n${variantTable(metrics.variants.filter((row) => row.experimentId === experimentId))}`

  fillMarker('docs/case-studies/A-async-render.md', 'case-a', section('case-a'))
  fillMarker('docs/case-studies/B-fingerprint.md', 'case-b', [
    envLine,
    '',
    variantTable(metrics.variants.filter((row) => row.experimentId === 'case-b')),
    '',
    'Signal diffs between the latest observation of each config:',
    '',
    ...(fingerprints.pairs[0]?.diffs.map((diff) => `- \`${diff.key}\`: \`${diff.left}\` → \`${diff.right}\``) ?? ['No pair recorded.']),
    '',
    `webdriver by config: ${JSON.stringify(benchmark.webdriverValues)}`,
    `sameWebdriver flag: ${String(fingerprints.pairs[0]?.sameWebdriver ?? 'n/a')}`,
  ].join('\n'))
  fillMarker('docs/case-studies/C-fleet.md', 'case-c', section('case-c'))
  fillMarker('README.md', 'summary', [
    envLine,
    '',
    `Stored runs: ${metrics.total}. Finished success rate (includes intentional baselines): ${metrics.successRate ?? 'n/a'}%.`,
    '',
    variantTable(metrics.variants.filter((row) => row.experimentId !== 'diagnostics')),
  ].join('\n'))
  console.log(`[seed] wrote results/benchmarks.json (${runs.length} runs)`)
} finally {
  await pool.close()
  await fixture.close()
  db.close()
}
