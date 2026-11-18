import fs from 'node:fs'
import type { AppConfig } from '../config.js'
import { Repo } from '../db/repo.js'
import { classify } from '../diagnostics/classify.js'
import { blockedObservation, isRetryableFailure, objectiveMet } from '../diagnostics/outcome.js'
import { getBrowserConfig } from '../engine/configs.js'
import type { BrowserPool } from '../engine/pool.js'
import { runAttempt } from '../engine/scrape.js'
import { assertUrlAllowed, isLoopback } from '../policy/allowlist.js'
import { assertLabInitScript } from '../policy/lab-scripts.js'
import { checkRobots } from '../policy/robots.js'
import { computeBackoff } from '../reliability/backoff.js'
import type { HostLimiter } from '../reliability/rate-limit.js'
import { shouldRetry } from '../reliability/retry.js'
import { logLine } from '../log.js'
import type { AttemptSummary, JobInput, LogLine, Observation, RunRecord } from '../shared/types.js'
import { sleep } from '../util.js'
import { resolveJob } from './resolve-job.js'

export class RunService {
  constructor(
    private readonly repo: Repo,
    private readonly pool: BrowserPool,
    private readonly fixtureOrigin: string,
    private readonly cfg: Pick<AppConfig, 'allowlistHosts' | 'allowExternal' | 'botUserAgent' | 'artifactDir'>,
  ) {}

  enqueue(input: JobInput): RunRecord {
    const job = resolveJob(input, this.fixtureOrigin)
    this.repo.insertQueued(job)
    const run = this.repo.getRun(job.id)
    if (!run) throw new Error('queued run was not stored')
    return run
  }

  async execute(input: JobInput, limiter?: HostLimiter | null): Promise<RunRecord> {
    const queued = this.enqueue(input)
    return this.runStored(queued.id, limiter ?? null)
  }

  async runStored(id: string, limiter: HostLimiter | null = null): Promise<RunRecord> {
    const job = this.repo.getJob(id)
    if (!job) throw new Error(`unknown run ${id}`)
    const logs: LogLine[] = []
    this.repo.markRunning(id)
    try {
      fs.mkdirSync(this.cfg.artifactDir, { recursive: true })
      const url = new URL(job.url)
      try {
        assertUrlAllowed(url, this.cfg)
        assertLabInitScript(job.labInitScript, isLoopback(url.hostname))
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        const observation = blockedObservation(job, 'allowlist', reason)
        this.store(id, observation, null, null, [
          logLine('warn', 'allowlist rejected the run', { reason }),
        ])
        return this.mustGet(id)
      }

      const robots = await checkRobots(url, this.cfg.botUserAgent)
      if (!robots.allowed) {
        const observation = blockedObservation(job, 'robots', robots.reason)
        this.store(id, observation, null, null, [logLine('info', 'robots.txt rejected the run', { reason: robots.reason })])
        return this.mustGet(id)
      }
      logs.push(logLine('info', 'robots.txt allowed the path', { reason: robots.reason }))

      const history: AttemptSummary[] = []
      let lastObservation: Observation | null = null
      let screenshotPath: string | null = null
      let tracePath: string | null = null
      const config = getBrowserConfig(job.browserConfigId)

      for (let attempt = 0; attempt <= job.maxRetries; attempt += 1) {
        if (attempt > 0) {
          const delay = computeBackoff(attempt - 1, job.backoffBaseMs, job.backoffMaxMs)
          logs.push(logLine('info', 'retry backoff', { attempt: attempt + 1, delayMs: delay }))
          await sleep(delay)
        }
        if (limiter) {
          logs.push(logLine('info', 'waiting for host rate limit', { host: url.hostname }))
          await limiter.acquire(url.hostname)
        }
        const started = Date.now()
        const captureJob = {
          ...job,
          captureScreenshot: job.captureScreenshot,
          captureTrace: job.captureTrace && attempt === 0,
        }
        const outcome = await this.pool.withContext(config, (context) =>
          runAttempt({
            context,
            job: captureJob,
            config,
            artifactDir: this.cfg.artifactDir,
            versionInfo: this.pool.versionInfo,
          }),
        )
        lastObservation = outcome.observation
        if (outcome.screenshotPath) screenshotPath = outcome.screenshotPath
        if (outcome.tracePath) tracePath = outcome.tracePath
        const retryable = isRetryableFailure(outcome.observation, job.retryOnMiss)
        history.push({
          attempt: attempt + 1,
          durationMs: Date.now() - started,
          httpStatus: outcome.observation.httpStatus,
          error: outcome.observation.navigationError ?? outcome.observation.selectorWaitError ?? outcome.observation.failFastText,
          retryable,
          selectorFound: outcome.observation.selectorFound,
          timedOut: outcome.observation.timedOut,
        })
        logs.push(
          logLine('info', 'attempt finished', {
            attempt: attempt + 1,
            httpStatus: outcome.observation.httpStatus,
            timedOut: outcome.observation.timedOut,
            retryable,
          }),
        )
        if (!shouldRetry({ attempt, maxRetries: job.maxRetries, retryable })) break
      }

      if (!lastObservation) throw new Error('run produced no observation')
      lastObservation.attempts = history
      if (lastObservation.fingerprint) {
        this.repo.insertFingerprint(id, job.browserConfigId, lastObservation.fingerprint)
      }
      this.store(id, lastObservation, screenshotPath, tracePath, logs)
    } catch (error) {
      logs.push(logLine('error', 'worker failed', { error: error instanceof Error ? error.message : String(error) }))
      this.repo.markError(id, error, logs)
    }
    return this.mustGet(id)
  }

  private store(
    id: string,
    observation: Observation,
    screenshotPath: string | null,
    tracePath: string | null,
    logs: LogLine[],
  ): void {
    const diagnostics = classify(observation)
    const ok = objectiveMet(observation)
    if (ok) diagnostics.primaryCategory = 'success'
    else if (diagnostics.primaryCategory === 'success') {
      diagnostics.findings.unshift({
        code: 'unclassified_failure',
        title: 'Unclassified failure',
        severity: 'failure',
        confidence: 'low',
        probableCause: 'The objective was not met and no specific rule claimed it. Treat the evidence as incomplete.',
        investigation: ['Inspect the network log, console, and final URL before assigning a cause.'],
        evidence: [{ source: 'summary', detail: diagnostics.summary }],
      })
      diagnostics.primaryCategory = 'unclassified_failure'
      diagnostics.summary = diagnostics.findings.map((item) => item.title).join('; ')
    }
    this.repo.finish(id, {
      status: ok ? 'success' : 'failed',
      observation,
      diagnostics,
      screenshotPath,
      tracePath,
      logs,
    })
  }

  private mustGet(id: string): RunRecord {
    const run = this.repo.getRun(id)
    if (!run) throw new Error(`run ${id} disappeared`)
    return run
  }
}
