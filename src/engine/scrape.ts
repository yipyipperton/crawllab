import fs from 'node:fs'
import path from 'node:path'
import type { BrowserContext, Page } from 'playwright'
import { collectFingerprint } from '../fingerprint/collect.js'
import type { BrowserVersionInfo } from './pool.js'
import type { BrowserConfig } from './configs.js'
import { assertLabInitScript } from '../policy/lab-scripts.js'
import { isLoopback } from '../policy/allowlist.js'
import type { Observation, RequestRecord, ResolvedJob } from '../shared/types.js'
import { clip } from '../util.js'

const HEADER_KEYS = ['content-type', 'retry-after', 'server', 'location', 'cache-control']

type WaitResult =
  | { kind: 'success' }
  | { kind: 'error'; text: string }
  | { kind: 'timeout'; error: string }

async function raceSelectors(
  page: Page,
  successSelector: string,
  errorSelector: string | null,
  timeoutMs: number,
): Promise<WaitResult> {
  const budget = Math.max(1, timeoutMs)
  return new Promise((resolve) => {
    let done = false
    const finish = (value: WaitResult) => {
      if (done) return
      done = true
      resolve(value)
    }
    page
      .waitForSelector(successSelector, { timeout: budget })
      .then(() => finish({ kind: 'success' }))
      .catch((error: unknown) => {
        finish({ kind: 'timeout', error: error instanceof Error ? error.message : String(error) })
      })
    if (errorSelector) {
      page
        .waitForSelector(errorSelector, { timeout: budget })
        .then(async (element) => {
          const text = await element.innerText().catch(() => '')
          finish({ kind: 'error', text: text.trim() })
        })
        .catch(() => undefined)
    }
  })
}

function blankObservation(job: ResolvedJob): Observation {
  return {
    requestedUrl: job.url,
    finalUrl: null,
    httpStatus: null,
    navigationError: null,
    selectorWaitError: null,
    timedOut: false,
    consoleMessages: [],
    pageErrors: [],
    failedRequests: [],
    requests: [],
    redirectChain: [],
    documentHeaders: {},
    extractedText: null,
    selector: job.selector,
    selectorFound: false,
    htmlSnippet: null,
    deferredRenderMarker: false,
    challengeMarker: null,
    challengeReason: null,
    durationMs: 0,
    navigationMs: 0,
    extractionMs: 0,
    attempts: [],
    transport: job.transport,
    robotsBlocked: false,
    robotsReason: null,
    allowlistBlocked: false,
    allowlistReason: null,
    responseExcerpt: null,
    waitStrategy: job.waitStrategy,
    failFast: false,
    failFastText: null,
    navigationTiming: null,
    expectedFinalIncludes: job.expectedFinalIncludes,
    fingerprint: null,
  }
}

function pickHeaders(headers: Record<string, string>): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const key of HEADER_KEYS) {
    const value = headers[key]
    if (value) picked[key] = value
  }
  return picked
}

export type AttemptCapture = {
  observation: Observation
  screenshotPath: string | null
  tracePath: string | null
}

export async function runAttempt(input: {
  context: BrowserContext
  job: ResolvedJob
  config: BrowserConfig
  artifactDir: string
  versionInfo: BrowserVersionInfo | null
}): Promise<AttemptCapture> {
  const { context, job } = input
  if (job.transport === 'http') return runHttpAttempt(input)
  return runBrowserAttempt(input)
}

async function runHttpAttempt(input: {
  context: BrowserContext
  job: ResolvedJob
  artifactDir: string
}): Promise<AttemptCapture> {
  const started = Date.now()
  const observation = blankObservation(input.job)
  try {
    const response = await input.context.request.get(input.job.url, {
      timeout: input.job.timeoutMs,
      failOnStatusCode: false,
    })
    const body = await response.text()
    observation.httpStatus = response.status()
    observation.finalUrl = response.url()
    observation.responseExcerpt = clip(body, 1500)
    observation.extractedText = clip(body, 1500)
    observation.documentHeaders = pickHeaders(response.headers())
    observation.htmlSnippet = clip(body, 1500)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    observation.navigationError = message
    observation.timedOut = /timeout/i.test(message)
  }
  observation.durationMs = Date.now() - started
  observation.navigationMs = observation.durationMs
  return { observation, screenshotPath: null, tracePath: null }
}

async function runBrowserAttempt(input: {
  context: BrowserContext
  job: ResolvedJob
  artifactDir: string
  versionInfo: BrowserVersionInfo | null
}): Promise<AttemptCapture> {
  const { context, job } = input
  const host = new URL(job.url).hostname
  assertLabInitScript(job.labInitScript, isLoopback(host))
  if (job.labInitScript) await context.addInitScript(job.labInitScript)

  let tracePath: string | null = null
  if (job.captureTrace) {
    tracePath = path.join(input.artifactDir, `${job.id}-trace.zip`)
    await context.tracing.start({ screenshots: true, snapshots: true })
  }

  const page = await context.newPage()
  const observation = blankObservation(job)
  const requests: RequestRecord[] = []
  const documents: Array<{ url: string; status: number; headers: Record<string, string> }> = []

  page.on('console', (message) => {
    if (observation.consoleMessages.length >= 40) return
    observation.consoleMessages.push({ type: message.type(), text: clip(message.text(), 500) })
  })
  page.on('pageerror', (error) => {
    if (observation.pageErrors.length >= 20) return
    observation.pageErrors.push(clip(error.message, 500))
  })
  page.on('requestfailed', (request) => {
    if (observation.failedRequests.length >= 40) return
    const failure = clip(request.failure()?.errorText ?? 'failed', 300)
    observation.failedRequests.push({
      url: clip(request.url(), 300),
      method: request.method(),
      errorText: failure,
      resourceType: request.resourceType(),
    })
    if (requests.length < 80) {
      requests.push({
        url: clip(request.url(), 300),
        method: request.method(),
        status: null,
        resourceType: request.resourceType(),
        failure,
      })
    }
  })
  page.on('response', (response) => {
    const request = response.request()
    if (requests.length < 80) {
      requests.push({
        url: clip(response.url(), 300),
        method: request.method(),
        status: response.status(),
        resourceType: request.resourceType(),
        failure: null,
      })
    }
    if (request.resourceType() === 'document' && documents.length < 20) {
      documents.push({
        url: clip(response.url(), 300),
        status: response.status(),
        headers: pickHeaders(response.headers()),
      })
    }
  })

  const started = Date.now()
  const deadline = started + job.timeoutMs
  const remaining = () => Math.max(1, deadline - Date.now())
  const waitUntil =
    job.waitStrategy === 'load' ? 'load' : job.waitStrategy === 'networkidle' ? 'networkidle' : 'domcontentloaded'

  try {
    const response = await page.goto(job.url, { waitUntil, timeout: remaining() })
    if (response) observation.httpStatus = response.status()
  } catch (error) {
    observation.navigationError = error instanceof Error ? error.message : String(error)
    observation.timedOut = /timeout/i.test(observation.navigationError)
  }
  observation.navigationMs = Date.now() - started

  const extractStarted = Date.now()
  if (job.selector && !observation.navigationError && job.waitStrategy === 'selector') {
    const waited = await raceSelectors(page, job.selector, job.errorSelector, remaining())
    if (waited.kind === 'timeout') {
      observation.selectorWaitError = waited.error
      observation.timedOut = true
    } else if (waited.kind === 'error') {
      observation.failFast = true
      observation.failFastText = waited.text
    }
  }

  if (job.selector) {
    try {
      const locator = page.locator(job.selector).first()
      if ((await locator.count()) > 0) {
        observation.selectorFound = true
        observation.extractedText = (await locator.innerText()).trim()
      }
    } catch {
      // The page can already be closing after a timeout.
    }
  }

  try {
    observation.finalUrl = page.url()
    observation.deferredRenderMarker = (await page.locator('[data-crawllab-render="deferred"]').count()) > 0
    const challenge = page.locator('[data-crawllab-challenge]').first()
    if ((await challenge.count()) > 0) {
      observation.challengeMarker = await challenge.getAttribute('data-crawllab-challenge')
      observation.challengeReason = await challenge.getAttribute('data-reason')
    }
    observation.htmlSnippet = clip(await page.content(), 1500)
    const timing = await page.evaluate(`(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      if (!nav) return null;
      return {
        domContentLoaded: nav.domContentLoadedEventEnd,
        load: nav.loadEventEnd,
        responseEnd: nav.responseEnd
      };
    })()`)
    if (timing && typeof timing === 'object') {
      const record = timing as Record<string, unknown>
      observation.navigationTiming = {
        domContentLoaded: Number(record.domContentLoaded ?? 0),
        load: Number(record.load ?? 0),
        responseEnd: Number(record.responseEnd ?? 0),
      }
    }
  } catch {
    // Evidence collection is best-effort after a failed navigation.
  }

  if (observation.httpStatus === null && documents.length > 0) {
    observation.httpStatus = documents[documents.length - 1]?.status ?? null
  }
  const lastDocument = documents[documents.length - 1]
  if (lastDocument) observation.documentHeaders = lastDocument.headers
  observation.redirectChain = documents.filter((document) => document.status >= 300 && document.status < 400)
  observation.requests = requests
  observation.extractionMs = Date.now() - extractStarted
  observation.durationMs = Date.now() - started

  if (job.collectFingerprint) {
    try {
      observation.fingerprint = await collectFingerprint(page, input.versionInfo)
    } catch (error) {
      observation.pageErrors.push(
        `fingerprint collection failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  let screenshotPath: string | null = null
  if (job.captureScreenshot) {
    screenshotPath = path.join(input.artifactDir, `${job.id}.png`)
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true })
    } catch {
      screenshotPath = null
    }
  }

  if (job.captureTrace && tracePath) {
    try {
      await context.tracing.stop({ path: tracePath })
    } catch {
      tracePath = null
    }
  }

  if (screenshotPath && !fs.existsSync(screenshotPath)) screenshotPath = null
  if (tracePath && !fs.existsSync(tracePath)) tracePath = null
  return { observation, screenshotPath, tracePath }
}
