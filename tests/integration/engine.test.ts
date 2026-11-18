import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp } from '../../src/api/server.js'
import { loadConfig } from '../../src/config.js'
import { getBrowserConfig } from '../../src/engine/configs.js'
import { BrowserPool } from '../../src/engine/pool.js'
import { getPreset } from '../../src/experiments/catalog.js'
import { createFixtureServer, type FixtureStats } from '../../src/fixtures/server.js'
import { sleep } from '../../src/util.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawllab-int-'))
const config = {
  ...loadConfig(),
  databasePath: path.join(dir, 'crawllab.sqlite'),
  artifactDir: path.join(dir, 'artifacts'),
  fixturePort: 0,
  browserConcurrency: 2,
  logLevel: 'warn',
}

let built: Awaited<ReturnType<typeof buildApp>>

beforeAll(async () => {
  built = await buildApp(config)
})

afterAll(async () => {
  await built?.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

async function runPreset(id: string) {
  const response = await built.app.inject({ method: 'POST', url: '/api/runs', payload: { preset: id } })
  expect(response.statusCode).toBe(202)
  const idOfRun = response.json().run.id as string
  for (let i = 0; i < 80; i += 1) {
    const current = await built.app.inject({ method: 'GET', url: `/api/runs/${idOfRun}` })
    const run = current.json()
    if (run.status === 'success' || run.status === 'failed' || run.status === 'error') return run
    await sleep(250)
  }
  throw new Error(`run ${id} did not finish`)
}

it('serves health and rejects an unknown preset', async () => {
  const health = await built.app.inject({ method: 'GET', url: '/api/health' })
  expect(health.statusCode).toBe(200)
  expect(health.json().ok).toBe(true)
  const rejected = await built.app.inject({ method: 'POST', url: '/api/runs', payload: { preset: 'nope' } })
  expect(rejected.statusCode).toBe(400)
})

it('extracts the static catalog and the documented JSON endpoint', async () => {
  const html = await runPreset('static-ok')
  expect(html.status).toBe('success')
  expect(html.extractedText).toContain('Copper kettle')
  const api = await built.service.execute(getPreset('case-a-api').job)
  expect(api.status).toBe('success')
  expect(api.extractedText).toContain('Brass compass')
})

it('fails an early DOM read, succeeds on the selector, and records the networkidle false timeout', async () => {
  const early = await built.service.execute({ ...getPreset('case-a-baseline').job, maxRetries: 0, retryOnMiss: false })
  expect(early.status).toBe('failed')
  expect(early.diagnostics.primaryCategory).toBe('async_content_not_ready')

  const ready = await built.service.execute(getPreset('case-a-selector').job)
  expect(ready.status).toBe('success')
  expect(ready.extractedText).toContain('Field notebook')

  const idle = await built.service.execute(getPreset('case-a-networkidle').job)
  expect(idle.status).toBe('failed')
  expect(idle.diagnostics.primaryCategory).toBe('networkidle_false_timeout')
  expect(idle.extractedText).toContain('Copper kettle')
})

it('classifies an HTTP 500 document', async () => {
  const run = await runPreset('diag-500')
  expect(run.status).toBe('failed')
  expect(run.diagnostics.primaryCategory).toBe('http_500')
  expect(run.httpStatus).toBe(500)
})

it('refuses a disallowed robots path without requesting it', async () => {
  const statsBefore = await fetch(`${built.fixtureUrl}/api/fixture-stats`).then((response) => response.json() as Promise<FixtureStats>)
  const run = await runPreset('diag-robots')
  const statsAfter = await fetch(`${built.fixtureUrl}/api/fixture-stats`).then((response) => response.json() as Promise<FixtureStats>)
  expect(run.status).toBe('failed')
  expect(run.diagnostics.primaryCategory).toBe('robots_disallowed')
  expect(statsAfter.privateHits).toBe(statsBefore.privateHits)
})

it('shows teaser without a token and partial with the lab token', async () => {
  const teaser = await runPreset('gate-teaser')
  expect(teaser.status).toBe('success')
  expect(teaser.extractedText).toBe('TEASER_ONLY')
  const partial = await runPreset('gate-partial')
  expect(partial.status).toBe('success')
  expect(partial.extractedText).toBe('PARTIAL_PAYLOAD_BETA')
  const full = await runPreset('gate-expect-full')
  expect(full.status).toBe('failed')
  expect(full.diagnostics.primaryCategory).toBe('access_challenge')
})

it('relaunches the browser after the current one is closed', async () => {
  const isolated = await createFixtureServer(0)
  const pool = new BrowserPool(undefined)
  try {
    await pool.withContext(getBrowserConfig('stock-headless'), async (context) => {
      const page = await context.newPage()
      await page.goto(`${isolated.url}/pages/static`, { waitUntil: 'domcontentloaded' })
      await context.browser()?.close()
    }).catch(() => undefined)
    await pool.withContext(getBrowserConfig('stock-headless'), async (context) => {
      const page = await context.newPage()
      const response = await page.goto(`${isolated.url}/health`)
      expect(response?.status()).toBe(200)
    })
  } finally {
    await pool.close()
    await isolated.close()
  }
})

it('records webdriver as true for the stock headless config', async () => {
  const run = await built.service.execute(getPreset('case-b-stock').job)
  expect(run.status).toBe('success')
  expect(run.evidence?.fingerprint?.webdriver).toBe(true)
  const listed = await built.app.inject({ method: 'GET', url: '/api/fingerprints' })
  expect(listed.statusCode).toBe(200)
  expect(listed.json().observations.length).toBeGreaterThan(0)
})
