import { randomUUID } from 'node:crypto'
import type { JobInput, ResolvedJob } from '../shared/types.js'
import { clamp } from '../util.js'

export function resolveUrl(input: JobInput, fixtureOrigin: string): string {
  if (input.url) {
    const url = new URL(input.url)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('only http and https URLs are allowed')
    }
    return url.toString()
  }
  if (!input.path || !input.path.startsWith('/')) throw new Error('job needs an absolute url or a path starting with /')
  return new URL(input.path, fixtureOrigin.endsWith('/') ? fixtureOrigin : `${fixtureOrigin}/`).toString()
}

export function resolveJob(input: JobInput, fixtureOrigin: string, id = input.id ?? randomUUID()): ResolvedJob {
  return {
    id,
    url: resolveUrl(input, fixtureOrigin),
    transport: input.transport ?? 'browser',
    waitStrategy: input.waitStrategy ?? 'domcontentloaded',
    selector: input.selector ?? null,
    errorSelector: input.errorSelector ?? null,
    timeoutMs: clamp(input.timeoutMs ?? 15_000, 100, 120_000),
    maxRetries: clamp(input.maxRetries ?? 0, 0, 8),
    retryOnMiss: input.retryOnMiss ?? false,
    backoffBaseMs: clamp(input.backoffBaseMs ?? 200, 0, 30_000),
    backoffMaxMs: clamp(input.backoffMaxMs ?? 5_000, 0, 60_000),
    browserConfigId: input.browserConfigId ?? 'stock-headless',
    captureScreenshot: input.captureScreenshot ?? false,
    captureTrace: input.captureTrace ?? false,
    collectFingerprint: input.collectFingerprint ?? false,
    expectedFinalIncludes: input.expectedFinalIncludes ?? null,
    experimentId: input.experimentId ?? null,
    variant: input.variant ?? null,
    role: input.role ?? null,
    labInitScript: input.labInitScript ?? null,
    label: input.label ?? null,
  }
}
