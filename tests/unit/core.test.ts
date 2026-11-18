import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { classify } from '../../src/diagnostics/classify.js'
import { isRetryableFailure, objectiveMet } from '../../src/diagnostics/outcome.js'
import { openDatabase } from '../../src/db/database.js'
import { Repo } from '../../src/db/repo.js'
import { diffSignals, signature } from '../../src/fingerprint/compare.js'
import { flakeDecision, slidingWindowAllow } from '../../src/fixtures/policy.js'
import { summarizeRuns } from '../../src/metrics/aggregate.js'
import { assertUrlAllowed } from '../../src/policy/allowlist.js'
import { PolicyError } from '../../src/policy/errors.js'
import { assertLabInitScript } from '../../src/policy/lab-scripts.js'
import { parseRobots } from '../../src/policy/robots.js'
import { computeBackoff } from '../../src/reliability/backoff.js'
import { TaskQueue } from '../../src/reliability/queue.js'
import { TokenBucket } from '../../src/reliability/rate-limit.js'
import { shouldRetry } from '../../src/reliability/retry.js'
import { analyzeScript } from '../../src/re/analyze.js'
import { minifyJs } from '../../src/re/minify.js'
import { simulateMatrix } from '../../src/re/simulate.js'
import { resolveJob } from '../../src/service/resolve-job.js'
import type { FingerprintSignals, RunRecord } from '../../src/shared/types.js'
import { percentile } from '../../src/util.js'
import { observation } from '../helpers.js'

const ROBOTS = `User-agent: *\nDisallow: /private\nAllow: /\n\nUser-agent: OtherBot\nAllow: /private\n`

describe('backoff, queue, and rate limit', () => {
  it('keeps equal jitter inside the exponential window', () => {
    expect(computeBackoff(0, 100, 1000, () => 0)).toBe(50)
    expect(computeBackoff(0, 100, 1000, () => 1)).toBe(100)
    expect(computeBackoff(3, 100, 150, () => 1)).toBe(150)
  })

  it('never exceeds the configured concurrency', async () => {
    const queue = new TaskQueue(2)
    let current = 0
    let max = 0
    await Promise.all(
      Array.from({ length: 6 }, () =>
        queue.run(async () => {
          current += 1
          max = Math.max(max, current)
          await new Promise((resolve) => setTimeout(resolve, 20))
          current -= 1
        }),
      ),
    )
    expect(max).toBeLessThanOrEqual(2)
    expect(max).toBe(2)
  })

  it('waits for a token when the bucket is empty', async () => {
    let now = 0
    const waits: number[] = []
    const bucket = new TokenBucket(
      1,
      10,
      () => now,
      async (ms) => {
        waits.push(ms)
        now += ms
      },
    )
    await bucket.acquire()
    await bucket.acquire()
    expect(waits[0]).toBe(100)
  })

  it('stops when the failure is not retryable or the budget is spent', () => {
    expect(shouldRetry({ attempt: 0, maxRetries: 2, retryable: true })).toBe(true)
    expect(shouldRetry({ attempt: 2, maxRetries: 2, retryable: true })).toBe(false)
    expect(shouldRetry({ attempt: 0, maxRetries: 2, retryable: false })).toBe(false)
  })
})

describe('policy', () => {
  const cfg = { allowlistHosts: ['127.0.0.1', 'localhost'], allowExternal: false }

  it('allows loopback and rejects external hosts and credentials', () => {
    expect(() => assertUrlAllowed(new URL('http://127.0.0.1/pages/static'), cfg)).not.toThrow()
    expect(() => assertUrlAllowed(new URL('http://example.com/'), cfg)).toThrow(PolicyError)
    expect(() => assertUrlAllowed(new URL('http://user:pass@127.0.0.1/'), cfg)).toThrow(/credentials/)
  })

  it('parses robots with longest-match and a specific agent', () => {
    expect(parseRobots(ROBOTS, '/private/secret', 'CrawlLabBot/1.0').allowed).toBe(false)
    expect(parseRobots(ROBOTS, '/pages/static', 'CrawlLabBot/1.0').allowed).toBe(true)
    expect(parseRobots(ROBOTS, '/private/secret', 'OtherBot/2').allowed).toBe(true)
  })

  it('rejects lab scripts that mention webdriver or are unknown', () => {
    expect(() => assertLabInitScript("window.__LAB_UNLOCK__='lab-unlock-7f3a';", true)).not.toThrow()
    expect(() => assertLabInitScript('navigator.webdriver = false', true)).toThrow(/webdriver|allowlist/)
    expect(() => assertLabInitScript("window.__LAB_UNLOCK__='lab-unlock-7f3a';", false)).toThrow(/loopback/)
  })
})

describe('diagnostics', () => {
  it('accepts a clean extraction', () => {
    const report = classify(observation())
    expect(report.primaryCategory).toBe('success')
    expect(objectiveMet(observation())).toBe(true)
  })

  it('explains deferred content without blaming a timeout', () => {
    const obs = observation({
      selectorFound: false,
      extractedText: null,
      deferredRenderMarker: true,
      waitStrategy: 'domcontentloaded',
    })
    const report = classify(obs)
    expect(report.primaryCategory).toBe('async_content_not_ready')
    expect(report.findings.find((item) => item.code === 'async_content_not_ready')?.confidence).toBe('high')
    expect(objectiveMet(obs)).toBe(false)
    expect(isRetryableFailure(obs, false)).toBe(false)
    expect(isRetryableFailure(obs, true)).toBe(true)
  })

  it('calls a networkidle timeout a false failure when the node is present and the heartbeat is visible', () => {
    const obs = observation({
      timedOut: true,
      waitStrategy: 'networkidle',
      navigationError: 'page.goto: Timeout 2500ms exceeded',
      requests: [
        { url: 'http://127.0.0.1/api/ping', method: 'GET', status: 200, resourceType: 'fetch', failure: null },
        { url: 'http://127.0.0.1/api/ping', method: 'GET', status: 200, resourceType: 'fetch', failure: null },
      ],
    })
    const report = classify(obs)
    expect(report.primaryCategory).toBe('networkidle_false_timeout')
    expect(report.findings[0]?.confidence).toBe('high')
    expect(objectiveMet(obs)).toBe(false)
  })

  it('classifies HTTP statuses, redirects, missing nodes, and empty renders', () => {
    expect(classify(observation({ httpStatus: 403 })).primaryCategory).toBe('http_403')
    expect(classify(observation({ httpStatus: 429, documentHeaders: { 'retry-after': '2' } })).primaryCategory).toBe('http_429')
    expect(classify(observation({ httpStatus: 500 })).primaryCategory).toBe('http_500')
    expect(isRetryableFailure(observation({ httpStatus: 403, selectorFound: false, extractedText: null }), true)).toBe(false)
    expect(isRetryableFailure(observation({ httpStatus: 500, selectorFound: false, extractedText: null }), false)).toBe(true)
    const redirect = observation({
      finalUrl: 'http://127.0.0.1:9/pages/unexpected-landing',
      expectedFinalIncludes: '/pages/static',
      selectorFound: false,
      extractedText: null,
      redirectChain: [
        { url: 'http://127.0.0.1:9/pages/redirect-mid', status: 302 },
        { url: 'http://127.0.0.1:9/pages/unexpected-landing', status: 302 },
      ],
    })
    expect(classify(redirect).primaryCategory).toBe('unexpected_redirect')
    expect(
      classify(observation({ selectorFound: false, extractedText: null, htmlSnippet: '<p>no catalog</p>' })).primaryCategory,
    ).toBe('missing_dom')
    expect(classify(observation({ extractedText: '' })).primaryCategory).toBe('extraction_empty')
  })

  it('keeps a JavaScript error at medium confidence and a subresource failure as a warning', () => {
    const report = classify(
      observation({
        selectorFound: false,
        extractedText: null,
        pageErrors: ['renderPipeline is not defined'],
      }),
    )
    const js = report.findings.find((item) => item.code === 'js_rendering_failure')
    expect(js?.confidence).toBe('medium')
    const resources = classify(
      observation({
        failedRequests: [
          { url: 'http://127.0.0.1/assets/missing.js', method: 'GET', errorText: '404', resourceType: 'script' },
        ],
      }),
    )
    expect(resources.findings.find((item) => item.code === 'failed_resource')?.severity).toBe('warning')
    expect(resources.primaryCategory).toBe('success')
  })

  it('does not turn a present lab challenge into a failed objective', () => {
    const info = classify(observation({ challengeMarker: 'gate', challengeReason: 'token missing' }))
    expect(info.findings.find((item) => item.code === 'access_challenge')?.severity).toBe('info')
    expect(info.primaryCategory).toBe('success')
    const blocked = classify(
      observation({
        challengeMarker: 'gate',
        challengeReason: 'navigator.webdriver is true',
        selectorFound: false,
        extractedText: null,
        timedOut: true,
        waitStrategy: 'selector',
        selectorWaitError: 'Timeout 3000ms exceeded',
      }),
    )
    expect(blocked.primaryCategory).toBe('access_challenge')
  })

  it('blocks allowlist and robots before navigation', () => {
    expect(classify(observation({ allowlistBlocked: true, allowlistReason: 'nope', selectorFound: false })).primaryCategory).toBe(
      'allowlist_blocked',
    )
    expect(classify(observation({ robotsBlocked: true, robotsReason: 'Disallow: /private', selectorFound: false })).primaryCategory).toBe(
      'robots_disallowed',
    )
  })
})

describe('metrics and fixture policy', () => {
  it('uses nearest-rank p95', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
    expect(percentile([], 95)).toBeNull()
  })

  it('splits success rate by role', () => {
    const base = observation()
    const runs: RunRecord[] = [
      fakeRun('success', 'baseline', 'case-a', 'baseline-dcl', 100, 'success'),
      fakeRun('failed', 'baseline', 'case-a', 'baseline-dcl', 80, 'async_content_not_ready'),
      fakeRun('success', 'improved', 'case-a', 'selector-ready', 900, 'success'),
    ]
    void base
    const summary = summarizeRuns(runs)
    expect(summary.successRate).toBe(66.7)
    expect(summary.byRole.find((role) => role.role === 'improved')?.successRate).toBe(100)
    expect(summary.variants.find((variant) => variant.variant === 'baseline-dcl')?.successes).toBe(1)
  })

  it('makes the injected flake and the sliding window deterministic', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(flakeDecision)).toEqual(['ok', 'ok', 'ok', 'fail', 'ok', 'ok', 'ok', 'fail'])
    const first = slidingWindowAllow([], 0)
    const second = slidingWindowAllow(first.next, 10)
    const third = slidingWindowAllow(second.next, 20)
    expect(first.allow && second.allow && !third.allow).toBe(true)
  })
})

describe('reverse engineering', () => {
  const source = fs.readFileSync(path.resolve('fixtures/js/gate.source.js'), 'utf8')

  it('folds the string table back into browser properties', () => {
    const analysis = analyzeScript(source)
    expect(analysis.foldedCalls).toEqual(expect.arrayContaining(['webdriver', 'userAgent']))
    expect(analysis.stringTables[0]?.values).toEqual(expect.arrayContaining(['lab-unlock-7f3a', 'FULL_PAYLOAD_ALPHA']))
    expect(analysis.minified.includes('\n')).toBe(false)
  })

  it('simulates every branch without touching a real browser', () => {
    const rows = simulateMatrix(minifyJs(source))
    const mode = (webdriver: string, token: boolean) =>
      rows.find((row) => row.webdriver === webdriver && row.token === token)?.mode
    expect(mode('true', false)).toBe('teaser')
    expect(mode('false', false)).toBe('teaser')
    expect(mode('true', true)).toBe('partial')
    expect(mode('false', true)).toBe('full')
    expect(mode('absent', true)).toBe('full')
  })
})

describe('persistence', () => {
  it('marks interrupted runs on startup and stores a finished run', () => {
    const file = path.join(os.tmpdir(), `crawllab-${Date.now()}.sqlite`)
    const repo = new Repo(openDatabase(file))
    const job = resolveJob({ path: '/pages/static', experimentId: 'diagnostics', variant: 'static', role: 'diagnostic' }, 'http://127.0.0.1:9')
    repo.insertQueued(job)
    expect(repo.recoverStale()).toBe(1)
    expect(repo.getRun(job.id)?.status).toBe('error')
    const second = resolveJob({ path: '/pages/static' }, 'http://127.0.0.1:9')
    repo.insertQueued(second)
    repo.markRunning(second.id)
    repo.finish(second.id, {
      status: 'success',
      observation: observation({ attempts: [{ attempt: 1, durationMs: 10, httpStatus: 200, error: null, retryable: false, selectorFound: true, timedOut: false }] }),
      diagnostics: { summary: 'ok', primaryCategory: 'success', findings: [] },
      screenshotPath: null,
      tracePath: null,
      logs: [],
    })
    expect(repo.getRun(second.id)?.status).toBe('success')
    fs.rmSync(file, { force: true })
  })
})

function fakeRun(
  status: RunRecord['status'],
  role: RunRecord['role'],
  experimentId: string,
  variant: string,
  durationMs: number,
  category: string,
): RunRecord {
  return {
    id: `${experimentId}-${variant}-${status}-${durationMs}`,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    url: 'http://127.0.0.1/pages/async',
    finalUrl: null,
    status,
    role,
    experimentId,
    variant,
    browserConfigId: 'stock-headless',
    waitStrategy: 'domcontentloaded',
    selector: '#catalog li',
    attemptCount: 1,
    durationMs,
    navigationMs: durationMs,
    extractionMs: 1,
    httpStatus: 200,
    errorMessage: null,
    extractedText: status === 'success' ? 'Copper kettle' : null,
    diagnostics: { summary: category, primaryCategory: category, findings: [] },
    evidence: null,
    screenshotPath: null,
    tracePath: null,
    logs: [],
    hasScreenshot: false,
    hasTrace: false,
    label: null,
  }
}

function signal(partial: Partial<FingerprintSignals>): FingerprintSignals {
  return {
    userAgent: 'ua',
    webdriver: true,
    language: 'en-US',
    languages: ['en-US'],
    platform: 'Linux',
    vendor: 'Google Inc.',
    hardwareConcurrency: 4,
    deviceMemory: 8,
    maxTouchPoints: 0,
    pluginsLength: 0,
    pdfViewerEnabled: true,
    cookieEnabled: true,
    webdriverOnPrototype: true,
    screen: { width: 1280, height: 720, colorDepth: 24 },
    viewport: { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 },
    timezone: 'America/New_York',
    hasChromeObject: true,
    webglVendor: 'v',
    webglRenderer: 'r',
    errorStackSample: 'Error',
    headlessTokenInUa: false,
    cdpBrowser: 'Chrome',
    cdpProtocolVersion: '1.3',
    cdpUserAgent: 'ua',
    cdpJsVersion: '1',
    requestHeaders: { 'user-agent': 'ua' },
    ...partial,
  }
}

describe('fingerprint diff', () => {
  it('reports user-agent changes and an unchanged webdriver bit', () => {
    const left = signal({ userAgent: 'Headless', webdriver: true })
    const right = signal({ userAgent: 'CrawlLabResearch/1.0', webdriver: true, language: 'de-DE' })
    const diffs = diffSignals(left, right)
    expect(diffs.map((item) => item.key)).toContain('userAgent')
    expect(diffs.map((item) => item.key)).not.toContain('webdriver')
    expect(signature(left)).not.toBe(signature(right))
  })
})
