import type { Observation, ResolvedJob } from '../shared/types.js'
import { nowIso } from '../util.js'

export function objectiveMet(obs: Observation): boolean {
  if (obs.allowlistBlocked || obs.robotsBlocked) return false
  if (obs.timedOut) return false
  if (obs.navigationError) return false
  if (obs.httpStatus !== null && obs.httpStatus >= 400) return false
  if (obs.transport === 'http') return (obs.responseExcerpt ?? '').trim().length > 0
  if (obs.selector) return obs.selectorFound && (obs.extractedText ?? '').trim().length > 0
  return true
}

export function isRetryableFailure(obs: Observation, retryOnMiss: boolean): boolean {
  if (objectiveMet(obs)) return false
  if (obs.allowlistBlocked || obs.robotsBlocked) return false
  if (obs.httpStatus === 401 || obs.httpStatus === 403 || obs.httpStatus === 404) return false
  if (obs.httpStatus === 429) return true
  if (obs.httpStatus !== null && obs.httpStatus >= 500) return true
  if (obs.failFast) return true
  if (obs.timedOut) return true
  if (
    obs.navigationError &&
    /net::|ECONN|ENOTFOUND|ERR_|closed|crashed|disconnected|Target page/i.test(obs.navigationError)
  ) {
    return true
  }
  if (retryOnMiss && obs.selector && !obs.selectorFound) return true
  return false
}

export function blockedObservation(
  job: ResolvedJob,
  kind: 'allowlist' | 'robots',
  reason: string,
): Observation {
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
    attempts: [
      {
        attempt: 1,
        durationMs: 0,
        httpStatus: null,
        error: reason,
        retryable: false,
        selectorFound: false,
        timedOut: false,
      },
    ],
    transport: job.transport,
    robotsBlocked: kind === 'robots',
    robotsReason: kind === 'robots' ? reason : null,
    allowlistBlocked: kind === 'allowlist',
    allowlistReason: kind === 'allowlist' ? reason : null,
    responseExcerpt: null,
    waitStrategy: job.waitStrategy,
    failFast: false,
    failFastText: null,
    navigationTiming: null,
    expectedFinalIncludes: job.expectedFinalIncludes,
    fingerprint: null,
  }
}

export function stamp(): string {
  return nowIso()
}
