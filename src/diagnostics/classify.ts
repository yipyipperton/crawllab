import type { Confidence, DiagnosticReport, Finding, Observation, Severity } from '../shared/types.js'
import { clip } from '../util.js'

const FAILURE_PRIORITY = [
  'allowlist_blocked',
  'robots_disallowed',
  'network_error',
  'http_403',
  'http_429',
  'http_500',
  'http_client_error',
  'unexpected_redirect',
  'access_challenge',
  'networkidle_false_timeout',
  'async_content_not_ready',
  'js_rendering_failure',
  'upstream_error',
  'selector_timeout',
  'navigation_timeout',
  'missing_dom',
  'extraction_empty',
  'unclassified_failure',
]

function finding(input: {
  code: string
  title: string
  severity: Severity
  confidence: Confidence
  probableCause: string
  investigation: string[]
  evidence: { source: string; detail: string }[]
}): Finding {
  return {
    ...input,
    evidence: input.evidence.map((item) => ({ source: item.source, detail: clip(item.detail, 500) })),
  }
}

export function summarize(findings: Finding[]): string {
  const failures = findings.filter((item) => item.severity === 'failure')
  if (failures.length === 0) {
    if (findings.length === 0) return 'No issues detected in the collected evidence.'
    return `Completed with ${findings.length} observation${findings.length === 1 ? '' : 's'} that did not fail the objective.`
  }
  return failures.map((item) => `${item.title} (${item.confidence} confidence)`).join('; ')
}

function primaryCategory(findings: Finding[]): string {
  const failures = findings.filter((item) => item.severity === 'failure')
  if (failures.length === 0) return 'success'
  for (const code of FAILURE_PRIORITY) {
    if (failures.some((item) => item.code === code)) return code
  }
  return failures[0]?.code ?? 'unclassified_failure'
}

function pingCount(obs: Observation): number {
  return obs.requests.filter((request) => request.url.includes('/api/ping')).length
}

function statusFinding(obs: Observation): Finding | null {
  const status = obs.httpStatus
  if (status === null || status < 400) return null
  const header = obs.documentHeaders['retry-after']
  const evidence = [
    { source: 'http-status', detail: `Final document status ${status} for ${obs.finalUrl ?? obs.requestedUrl}` },
  ]
  if (header) evidence.push({ source: 'retry-after', detail: header })
  if (obs.responseExcerpt) evidence.push({ source: 'body', detail: obs.responseExcerpt })
  if (status === 401 || status === 403) {
    return finding({
      code: 'http_403',
      title: `HTTP ${status}`,
      severity: 'failure',
      confidence: 'high',
      probableCause:
        'The origin refused the document. A 401/403 on this lab fixture is an explicit deny, not a transient network error.',
      investigation: [
        'Confirm the status on the main document rather than a subresource.',
        'Check whether the path is intentionally denied. Do not rotate identities or headers to get past a 403.',
        'If the target is authorized, use the published endpoint instead of a blocked path.',
      ],
      evidence,
    })
  }
  if (status === 429) {
    return finding({
      code: 'http_429',
      title: 'HTTP 429',
      severity: 'failure',
      confidence: 'high',
      probableCause:
        'The origin returned 429 Too Many Requests. Immediate retries usually extend the refusal unless they wait for the server window to refill.',
      investigation: [
        'Read Retry-After when it is present and delay at least that long.',
        'Check client concurrency. A burst from several workers can exhaust a small window.',
        'Put a shared per-host token bucket in front of the browser pool and compare a paced run with a burst run.',
      ],
      evidence,
    })
  }
  if (status >= 500) {
    return finding({
      code: 'http_500',
      title: `HTTP ${status}`,
      severity: 'failure',
      confidence: 'high',
      probableCause:
        'The origin failed the request. On the lab fixture, some 500s are injected and clear on a later attempt; a single sample cannot tell a transient fault from a deterministic bug.',
      investigation: [
        'Record the response body and whether a retry with backoff changes the status.',
        'If every attempt fails, stop retrying and inspect the handler. Retries only help intermittent 5xx.',
        'Separate origin 500s from navigation timeouts so the dashboard does not merge them.',
      ],
      evidence,
    })
  }
  return finding({
    code: 'http_client_error',
    title: `HTTP ${status}`,
    severity: 'failure',
    confidence: 'high',
    probableCause: `The document returned HTTP ${status}. The client asked for a resource the origin did not serve.`,
    investigation: [
      'Confirm the URL path against the fixture route table.',
      'Treat 4xx other than 429 as non-retryable unless the origin documents otherwise.',
    ],
    evidence,
  })
}

export function classify(obs: Observation): DiagnosticReport {
  const findings: Finding[] = []

  if (obs.allowlistBlocked) {
    findings.push(
      finding({
        code: 'allowlist_blocked',
        title: 'Blocked by allowlist',
        severity: 'failure',
        confidence: 'high',
        probableCause: obs.allowlistReason ?? 'The URL is outside the configured allowlist.',
        investigation: [
          'CrawlLab navigates only to allowlisted hosts. Loopback is the default.',
          'External hosts also require ALLOW_EXTERNAL=true. That switch does not skip robots.txt.',
        ],
        evidence: [{ source: 'policy', detail: obs.allowlistReason ?? obs.requestedUrl }],
      }),
    )
  }

  if (obs.robotsBlocked) {
    findings.push(
      finding({
        code: 'robots_disallowed',
        title: 'Blocked by robots.txt',
        severity: 'failure',
        confidence: 'high',
        probableCause: obs.robotsReason ?? 'robots.txt disallows this path.',
        investigation: [
          'The navigation was not attempted. A direct request can still succeed; the engine refuses first.',
          'If the path should be collectable, change the fixture robots.txt. Do not ignore it for a live host.',
        ],
        evidence: [{ source: 'robots', detail: obs.robotsReason ?? obs.requestedUrl }],
      }),
    )
  }

  if (
    obs.navigationError &&
    /net::|ECONNREFUSED|ECONNRESET|ENOTFOUND|ERR_CONNECTION|ERR_NAME|ERR_INTERNET|NS_ERROR/i.test(
      obs.navigationError,
    ) &&
    !obs.timedOut
  ) {
    findings.push(
      finding({
        code: 'network_error',
        title: 'Network connection error',
        severity: 'failure',
        confidence: 'high',
        probableCause: 'The browser reported a transport failure before a document status was usable.',
        investigation: [
          'Check that the fixture server is still listening and the URL host matches it.',
          'A closed browser or aborted context surfaces as a connection error and should relaunch the browser before a retry.',
        ],
        evidence: [{ source: 'navigation-error', detail: obs.navigationError }],
      }),
    )
  }

  const http = statusFinding(obs)
  if (http) findings.push(http)

  const redirects = obs.redirectChain
  let finalHostDiffers = false
  try {
    if (obs.finalUrl) {
      finalHostDiffers = new URL(obs.finalUrl).host !== new URL(obs.requestedUrl).host
    }
  } catch {
    finalHostDiffers = false
  }
  const expected = obs.expectedFinalIncludes
  const missedExpected = Boolean(expected && obs.finalUrl && !obs.finalUrl.includes(expected))
  if (missedExpected || finalHostDiffers) {
    findings.push(
      finding({
        code: 'unexpected_redirect',
        title: 'Unexpected redirect',
        severity: 'failure',
        confidence: 'high',
        probableCause: missedExpected
          ? `The navigation ended at ${obs.finalUrl}, which does not contain the expected marker "${expected}".`
          : `The document host changed from ${obs.requestedUrl} to ${obs.finalUrl}.`,
        investigation: [
          'Read the redirect chain. A same-site hop can be legitimate; a host change needs an explicit decision.',
          'Extract from the final URL only after confirming it is still the resource you meant to collect.',
        ],
        evidence: [
          { source: 'final-url', detail: obs.finalUrl ?? 'unknown' },
          {
            source: 'redirect-chain',
            detail: redirects.map((hop) => `${hop.status} ${hop.url}`).join(' | ') || 'no 3xx hops recorded',
          },
        ],
      }),
    )
  } else if (redirects.length > 0) {
    findings.push(
      finding({
        code: 'redirect_observed',
        title: 'Redirect observed',
        severity: 'info',
        confidence: 'high',
        probableCause: 'The document followed one or more redirects and landed on an accepted URL.',
        investigation: ['Keep the chain in the run record so a later host change is visible.'],
        evidence: [
          {
            source: 'redirect-chain',
            detail: redirects.map((hop) => `${hop.status} ${hop.url}`).join(' | '),
          },
        ],
      }),
    )
  }
  if (redirects.length >= 3) {
    findings.push(
      finding({
        code: 'long_redirect_chain',
        title: 'Long redirect chain',
        severity: 'warning',
        confidence: 'medium',
        probableCause: `${redirects.length} redirects were recorded. Long chains add latency and can hide an unexpected hop.`,
        investigation: ['Collapse the chain on the server if this is your fixture. Follow each Location header in the evidence.'],
        evidence: [{ source: 'redirect-count', detail: String(redirects.length) }],
      }),
    )
  }

  const pings = pingCount(obs)
  if (obs.timedOut && obs.waitStrategy === 'networkidle' && obs.selectorFound) {
    findings.push(
      finding({
        code: 'networkidle_false_timeout',
        title: 'networkidle timed out after content was ready',
        severity: 'failure',
        confidence: pings >= 2 ? 'high' : 'medium',
        probableCause:
          pings >= 2
            ? 'The wait condition was networkidle, but /api/ping kept the network active. The target node was already in the DOM when the timeout fired, so the failure is the wait condition.'
            : 'networkidle timed out even though the target node was present. The request log does not show enough heartbeat traffic to be certain why the network stayed active.',
        investigation: [
          'Do not retry the same networkidle wait. Each attempt spends the full timeout.',
          'Wait for the selector that holds the data.',
          'Inspect repeating requests in the network log before changing the timeout budget.',
        ],
        evidence: [
          { source: 'timeout', detail: obs.navigationError ?? obs.selectorWaitError ?? 'timeout' },
          { source: 'extracted-text', detail: obs.extractedText ?? '' },
          { source: 'ping-requests', detail: String(pings) },
        ],
      }),
    )
  }

  const pageLoaded = !obs.navigationError && !obs.timedOut && (obs.httpStatus === null || obs.httpStatus < 400)
  if (obs.selector && !obs.selectorFound && pageLoaded && obs.deferredRenderMarker) {
    findings.push(
      finding({
        code: 'async_content_not_ready',
        title: 'Deferred content was not ready',
        severity: 'failure',
        confidence: 'high',
        probableCause:
          'The document exposes data-crawllab-render=deferred and the target selector was absent after the chosen load event. The page is telling the client that the node is inserted later.',
        investigation: [
          'Re-run with waitStrategy selector. Retrying DOMContentLoaded does not create the node.',
          'In a trace, find the timer or fetch that inserts the selector and compare it with the load event.',
          'If you operate the origin, prefer the documented JSON endpoint, which does not depend on the timer.',
        ],
        evidence: [
          { source: 'selector', detail: obs.selector },
          { source: 'wait-strategy', detail: obs.waitStrategy },
          { source: 'marker', detail: 'data-crawllab-render=deferred' },
        ],
      }),
    )
  } else if (obs.selector && !obs.selectorFound && pageLoaded && !obs.failFast) {
    findings.push(
      finding({
        code: 'missing_dom',
        title: 'Target element missing',
        severity: 'failure',
        confidence: 'high',
        probableCause:
          'The navigation finished without a timeout and the selector was not in the DOM. Nothing in the captured page declares that the node will appear later.',
        investigation: [
          'Confirm the selector against the rendered HTML snippet.',
          'Check for an unexpected final URL before treating this as a renderer bug.',
          'If console errors are also present, the script may have aborted before inserting the node. That link is only as strong as the error text.',
        ],
        evidence: [
          { source: 'selector', detail: obs.selector },
          { source: 'html', detail: obs.htmlSnippet ?? '' },
        ],
      }),
    )
  }

  if (obs.timedOut && obs.waitStrategy === 'selector' && !obs.selectorFound) {
    findings.push(
      finding({
        code: 'selector_timeout',
        title: 'Selector wait timed out',
        severity: 'failure',
        confidence: 'high',
        probableCause: obs.failFast
          ? 'The error marker appeared, or the selector never appeared, inside the timeout budget.'
          : 'The selector did not appear before the timeout. If the render time is longer than the budget, retries repeat the same timeout.',
        investigation: [
          'Compare the timeout with the fixture delay. A budget below the render delay fails on every attempt.',
          'Use the error selector to fail fast on HTTP errors instead of waiting out the budget.',
          'Increase the budget only after a successful long-timeout run shows the node does appear.',
        ],
        evidence: [
          { source: 'timeout', detail: obs.selectorWaitError ?? obs.navigationError ?? 'selector timeout' },
          { source: 'budget-ms', detail: String(obs.durationMs) },
          { source: 'fail-fast', detail: obs.failFastText ?? 'none' },
        ],
      }),
    )
  }

  if (
    obs.timedOut &&
    !obs.selectorFound &&
    obs.waitStrategy !== 'selector' &&
    !(obs.waitStrategy === 'networkidle' && obs.selectorFound)
  ) {
    findings.push(
      finding({
        code: 'navigation_timeout',
        title: 'Navigation timed out',
        severity: 'failure',
        confidence: /timeout/i.test(obs.navigationError ?? '') ? 'high' : 'medium',
        probableCause:
          'The browser did not reach the requested load state inside the timeout. The target selector was also absent, so this is not only a too-strict wait condition.',
        investigation: [
          'Check the request log for a hung document or a redirect loop.',
          'Distinguish a slow origin from a wait condition that can never be satisfied.',
        ],
        evidence: [{ source: 'navigation-error', detail: obs.navigationError ?? 'timeout' }],
      }),
    )
  }

  if (obs.pageErrors.length > 0 && (!obs.selectorFound || !(obs.extractedText ?? '').trim())) {
    findings.push(
      finding({
        code: 'js_rendering_failure',
        title: 'JavaScript error during render',
        severity: obs.selector && !obs.selectorFound ? 'failure' : 'warning',
        confidence: 'medium',
        probableCause:
          'An uncaught page error was recorded and the extraction was empty or missing. The error is evidence of a broken script. It is not proof, by itself, that the error is why the node is absent.',
        investigation: [
          'Read the pageerror text and the console entries together.',
          'Reproduce the page in a headed trace and see whether the throwing line runs before the node is inserted.',
        ],
        evidence: [
          ...obs.pageErrors.slice(0, 5).map((text) => ({ source: 'pageerror', detail: text })),
          ...obs.consoleMessages
            .filter((entry) => entry.type === 'error')
            .slice(0, 5)
            .map((entry) => ({ source: 'console', detail: entry.text })),
        ],
      }),
    )
  } else if (obs.consoleMessages.some((entry) => entry.type === 'error') || obs.pageErrors.length > 0) {
    findings.push(
      finding({
        code: 'console_error',
        title: 'Console error recorded',
        severity: 'warning',
        confidence: 'high',
        probableCause: 'The page logged an error. The extraction still met its objective, so the error is not classified as the cause of a failed run.',
        investigation: ['Decide whether the error is on the path of the data you extract before treating the run as unhealthy.'],
        evidence: obs.consoleMessages
          .filter((entry) => entry.type === 'error')
          .slice(0, 5)
          .map((entry) => ({ source: 'console', detail: entry.text })),
      }),
    )
  }

  if (
    obs.selector &&
    obs.selectorFound &&
    !(obs.extractedText ?? '').trim() &&
    !obs.timedOut &&
    (obs.httpStatus === null || obs.httpStatus < 400)
  ) {
    findings.push(
      finding({
        code: 'extraction_empty',
        title: 'Selector matched an empty node',
        severity: 'failure',
        confidence: 'high',
        probableCause: 'The selector exists but its text is empty. The node may be a placeholder that a script was supposed to fill.',
        investigation: [
          'Check page errors for a function that should have written the text.',
          'Wait for a more specific selector such as a child that is created only when data is ready.',
        ],
        evidence: [{ source: 'selector', detail: obs.selector }],
      }),
    )
  }

  if (obs.challengeMarker) {
    const blocked = !obs.selectorFound || !(obs.extractedText ?? '').trim()
    findings.push(
      finding({
        code: 'access_challenge',
        title: 'Lab access challenge',
        severity: blocked ? 'failure' : 'info',
        confidence: 'high',
        probableCause: `The fixture set data-crawllab-challenge=${obs.challengeMarker}. ${obs.challengeReason ?? 'No reason attribute was set.'} This is a lab marker, not a third-party CAPTCHA.`,
        investigation: [
          'Read the gate-script report. The full payload requires the lab token and navigator.webdriver to be strictly false.',
          'Playwright reports webdriver true. This project does not change that property.',
          'Observe the teaser and partial payloads. Do not mask automation signals to reach the full branch.',
        ],
        evidence: [
          { source: 'challenge', detail: obs.challengeMarker },
          { source: 'reason', detail: obs.challengeReason ?? 'none' },
          { source: 'extracted-text', detail: obs.extractedText ?? '' },
        ],
      }),
    )
  }

  const subresources = obs.failedRequests.filter((request) => request.resourceType !== 'document')
  if (subresources.length > 0) {
    findings.push(
      finding({
        code: 'failed_resource',
        title: 'Failed subresource',
        severity: 'warning',
        confidence: 'high',
        probableCause: `${subresources.length} subresource request(s) failed. The document itself may still have loaded.`,
        investigation: [
          'Ignore favicon failures if they are the only ones. A failed script can explain an empty render.',
          'Match the failed URL to a tag in the HTML snippet.',
        ],
        evidence: subresources.slice(0, 8).map((request) => ({
          source: request.resourceType,
          detail: `${request.method} ${request.url} ${request.errorText}`,
        })),
      }),
    )
  }

  if (obs.failFast && obs.failFastText) {
    findings.push(
      finding({
        code: 'upstream_error',
        title: 'Page reported an upstream error',
        severity: 'failure',
        confidence: 'high',
        probableCause: `The error selector matched before the success selector (${obs.failFastText}). The document status can still be 200 because the failure happened in a follow-up request.`,
        investigation: [
          'Read the error text. HTTP 429 and 5xx from the lab fixture are retryable; 403 is not.',
          'Failing fast avoids spending the whole timeout on a response that has already failed.',
          'Confirm the failed URL in the network log so the diagnostic is tied to that response, not to the HTML shell.',
        ],
        evidence: [{ source: 'error-selector', detail: obs.failFastText }],
      }),
    )
  }

  const priorFailures = obs.attempts.slice(0, -1).some((attempt) => attempt.timedOut || attempt.error || !attempt.selectorFound)
  const finalOk =
    !obs.timedOut &&
    !obs.navigationError &&
    (obs.httpStatus === null || obs.httpStatus < 400) &&
    (!obs.selector || (obs.selectorFound && (obs.extractedText ?? '').trim().length > 0))
  if (obs.attempts.length > 1 && priorFailures && finalOk) {
    findings.push(
      finding({
        code: 'recovered_after_retry',
        title: 'Recovered after retry',
        severity: 'info',
        confidence: 'high',
        probableCause: `The run succeeded on attempt ${obs.attempts.length} after an earlier failure. Backoff and a retry budget changed the outcome for this sample.`,
        investigation: ['Check that the earlier failure was transient (429, 500, overload) and not a missing selector under the same wait strategy.'],
        evidence: obs.attempts.map((attempt) => ({
          source: `attempt-${attempt.attempt}`,
          detail: `status=${attempt.httpStatus ?? 'n/a'} timeout=${attempt.timedOut} error=${attempt.error ?? 'none'}`,
        })),
      }),
    )
  }

  const rank = (item: Finding): number => {
    const severityRank = item.severity === 'failure' ? 0 : item.severity === 'warning' ? 1 : 2
    const codeRank = FAILURE_PRIORITY.indexOf(item.code)
    return severityRank * 100 + (codeRank === -1 ? 50 : codeRank)
  }
  findings.sort((a, b) => rank(a) - rank(b))

  return {
    summary: summarize(findings),
    primaryCategory: primaryCategory(findings),
    findings,
  }
}
