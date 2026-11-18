import fs from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import type { AppConfig } from '../config.js'
import { openDatabase } from '../db/database.js'
import { Repo } from '../db/repo.js'
import { listBrowserConfigs } from '../engine/configs.js'
import { BrowserPool } from '../engine/pool.js'
import { presetViews, getPreset } from '../experiments/catalog.js'
import { createFixtureServer } from '../fixtures/server.js'
import { summarizeRuns } from '../metrics/aggregate.js'
import { compareObservations } from '../fingerprint/compare.js'
import { TaskQueue } from '../reliability/queue.js'
import { buildGateReport } from '../re/report.js'
import { RunService } from '../service/run-service.js'
import { getCaseDocument, listCaseDocuments } from './cases.js'

function insideDir(root: string, file: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(file))
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export async function buildApp(config: AppConfig): Promise<{
  app: FastifyInstance
  close: () => Promise<void>
  repo: Repo
  service: RunService
  fixtureUrl: string
}> {
  const fixture = await createFixtureServer(config.fixturePort, { logger: false })
  const db = openDatabase(config.databasePath)
  const repo = new Repo(db)
  const recovered = repo.recoverStale()
  const pool = new BrowserPool(config.browserChannel)
  const service = new RunService(repo, pool, fixture.url, config)
  const queue = new TaskQueue(config.browserConcurrency)
  const app = Fastify({ logger: { level: config.logLevel } })
  await app.register(cors, { origin: true })

  app.get('/api/health', async () => ({
    ok: true,
    fixtureOrigin: fixture.url,
    browserChannel: pool.channel,
    recoveredStaleRuns: recovered,
  }))

  app.get('/api/overview', async () => {
    const runs = repo.allRuns()
    return {
      metrics: summarizeRuns(runs),
      recent: repo.listRuns({ limit: 8, offset: 0 }).runs,
      meta: repo.getMeta('benchmark'),
      presets: presetViews(),
      configs: listBrowserConfigs(),
    }
  })

  app.get('/api/metrics', async () => summarizeRuns(repo.allRuns()))

  app.get('/api/runs', async (request) => {
    const query = request.query as {
      status?: string
      experimentId?: string
      variant?: string
      role?: string
      limit?: string
      offset?: string
    }
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50)))
    const offset = Math.max(0, Number(query.offset ?? 0))
    return repo.listRuns({
      status: query.status,
      experimentId: query.experimentId,
      variant: query.variant,
      role: query.role,
      limit,
      offset,
    })
  })

  app.get('/api/runs/:id', async (request, reply) => {
    const run = repo.getRun((request.params as { id: string }).id)
    if (!run) return reply.code(404).send({ error: 'not_found' })
    return run
  })

  app.get('/api/runs/:id/screenshot', async (request, reply) => {
    const run = repo.getRun((request.params as { id: string }).id)
    if (!run?.screenshotPath || !insideDir(config.artifactDir, run.screenshotPath)) {
      return reply.code(404).send({ error: 'no_screenshot' })
    }
    return reply.type('image/png').send(fs.readFileSync(run.screenshotPath))
  })

  app.get('/api/runs/:id/trace', async (request, reply) => {
    const run = repo.getRun((request.params as { id: string }).id)
    if (!run?.tracePath || !insideDir(config.artifactDir, run.tracePath)) {
      return reply.code(404).send({ error: 'no_trace' })
    }
    return reply
      .type('application/zip')
      .header('content-disposition', `attachment; filename="${run.id}-trace.zip"`)
      .send(fs.readFileSync(run.tracePath))
  })

  app.post('/api/runs', async (request, reply) => {
    const body = (request.body ?? {}) as { preset?: string }
    if (!body.preset) return reply.code(400).send({ error: 'preset is required' })
    let preset
    try {
      preset = getPreset(body.preset)
    } catch {
      return reply.code(400).send({ error: 'unknown preset' })
    }
    const run = service.enqueue(preset.job)
    void queue.run(() => service.runStored(run.id)).catch((error) => {
      app.log.error({ err: error, runId: run.id }, 'queued run failed')
    })
    return reply.code(202).send({ run: repo.getRun(run.id) })
  })

  app.get('/api/presets', async () => presetViews())
  app.get('/api/configs', async () => listBrowserConfigs())

  app.get('/api/experiments', async () => ({
    variants: summarizeRuns(repo.allRuns()).variants,
    notes: repo.listNotes(),
  }))

  app.get('/api/fingerprints', async () => {
    const observations = repo.listFingerprints()
    const comparison = compareObservations(observations)
    return { observations, ...comparison, configs: listBrowserConfigs() }
  })

  app.get('/api/cases', async () =>
    listCaseDocuments().map((item) => ({ id: item.id, title: item.title, summary: item.summary })),
  )
  app.get('/api/cases/:id', async (request, reply) => {
    const document = getCaseDocument((request.params as { id: string }).id)
    if (!document) return reply.code(404).send({ error: 'not_found' })
    return document
  })

  app.get('/api/research/gate', async () => buildGateReport())
  app.get('/api/meta', async () => repo.getMeta('benchmark'))

  const webRoot = path.resolve('web/dist')
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
  }
  app.setNotFoundHandler((request, reply) => {
    const url = request.url.split('?')[0] ?? '/'
    if (url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' })
    const index = path.join(webRoot, 'index.html')
    if (!fs.existsSync(index)) return reply.code(404).send({ error: 'not_found' })
    let requested = '/'
    try {
      requested = path.normalize(decodeURIComponent(url))
    } catch {
      requested = '/'
    }
    const file = path.join(webRoot, requested)
    if (insideDir(webRoot, file) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const type = mime[path.extname(file)] ?? 'application/octet-stream'
      return reply.type(type).send(fs.readFileSync(file))
    }
    return reply.type('text/html; charset=utf-8').send(fs.readFileSync(index))
  })

  return {
    app,
    repo,
    service,
    fixtureUrl: fixture.url,
    close: async () => {
      await app.close()
      await pool.close()
      await fixture.close()
      db.close()
    },
  }
}
