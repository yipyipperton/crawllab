export type WaitStrategy = 'load' | 'domcontentloaded' | 'networkidle' | 'selector'
export type Transport = 'browser' | 'http'
export type RunStatus = 'queued' | 'running' | 'success' | 'failed' | 'error'
export type RunRole = 'baseline' | 'improved' | 'diagnostic' | 'research'
export type Confidence = 'low' | 'medium' | 'high'
export type Severity = 'info' | 'warning' | 'failure'

export type JobInput = {
  id?: string
  path?: string
  url?: string
  transport?: Transport
  waitStrategy?: WaitStrategy
  selector?: string | null
  errorSelector?: string | null
  timeoutMs?: number
  maxRetries?: number
  retryOnMiss?: boolean
  backoffBaseMs?: number
  backoffMaxMs?: number
  browserConfigId?: string
  captureScreenshot?: boolean
  captureTrace?: boolean
  collectFingerprint?: boolean
  expectedFinalIncludes?: string | null
  experimentId?: string | null
  variant?: string | null
  role?: RunRole | null
  labInitScript?: string | null
  label?: string | null
}

export type ResolvedJob = {
  id: string
  url: string
  transport: Transport
  waitStrategy: WaitStrategy
  selector: string | null
  errorSelector: string | null
  timeoutMs: number
  maxRetries: number
  retryOnMiss: boolean
  backoffBaseMs: number
  backoffMaxMs: number
  browserConfigId: string
  captureScreenshot: boolean
  captureTrace: boolean
  collectFingerprint: boolean
  expectedFinalIncludes: string | null
  experimentId: string | null
  variant: string | null
  role: RunRole | null
  labInitScript: string | null
  label: string | null
}

export type RequestRecord = {
  url: string
  method: string
  status: number | null
  resourceType: string
  failure: string | null
}

export type AttemptSummary = {
  attempt: number
  durationMs: number
  httpStatus: number | null
  error: string | null
  retryable: boolean
  selectorFound: boolean
  timedOut: boolean
}

export type FingerprintSignals = {
  userAgent: string
  webdriver: boolean | null
  language: string | null
  languages: string[]
  platform: string | null
  vendor: string | null
  hardwareConcurrency: number | null
  deviceMemory: number | null
  maxTouchPoints: number | null
  pluginsLength: number | null
  pdfViewerEnabled: boolean | null
  cookieEnabled: boolean | null
  webdriverOnPrototype: boolean | null
  screen: { width: number; height: number; colorDepth: number } | null
  viewport: { innerWidth: number; innerHeight: number; devicePixelRatio: number } | null
  timezone: string | null
  hasChromeObject: boolean | null
  webglVendor: string | null
  webglRenderer: string | null
  errorStackSample: string | null
  headlessTokenInUa: boolean
  cdpBrowser: string | null
  cdpProtocolVersion: string | null
  cdpUserAgent: string | null
  cdpJsVersion: string | null
  requestHeaders: Record<string, string>
}

export type Observation = {
  requestedUrl: string
  finalUrl: string | null
  httpStatus: number | null
  navigationError: string | null
  selectorWaitError: string | null
  timedOut: boolean
  consoleMessages: { type: string; text: string }[]
  pageErrors: string[]
  failedRequests: { url: string; method: string; errorText: string; resourceType: string }[]
  requests: RequestRecord[]
  redirectChain: { url: string; status: number }[]
  documentHeaders: Record<string, string>
  extractedText: string | null
  selector: string | null
  selectorFound: boolean
  htmlSnippet: string | null
  deferredRenderMarker: boolean
  challengeMarker: string | null
  challengeReason: string | null
  durationMs: number
  navigationMs: number
  extractionMs: number
  attempts: AttemptSummary[]
  transport: Transport
  robotsBlocked: boolean
  robotsReason: string | null
  allowlistBlocked: boolean
  allowlistReason: string | null
  responseExcerpt: string | null
  waitStrategy: WaitStrategy
  failFast: boolean
  failFastText: string | null
  navigationTiming: { domContentLoaded: number; load: number; responseEnd: number } | null
  expectedFinalIncludes: string | null
  fingerprint: FingerprintSignals | null
}

export type Finding = {
  code: string
  title: string
  severity: Severity
  confidence: Confidence
  probableCause: string
  investigation: string[]
  evidence: { source: string; detail: string }[]
}

export type DiagnosticReport = {
  summary: string
  primaryCategory: string
  findings: Finding[]
}

export type LogLine = {
  at: string
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  data?: Record<string, unknown>
}

export type RunRecord = {
  id: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  url: string
  finalUrl: string | null
  status: RunStatus
  role: RunRole | null
  experimentId: string | null
  variant: string | null
  browserConfigId: string | null
  waitStrategy: string | null
  selector: string | null
  attemptCount: number
  durationMs: number | null
  navigationMs: number | null
  extractionMs: number | null
  httpStatus: number | null
  errorMessage: string | null
  extractedText: string | null
  diagnostics: DiagnosticReport
  evidence: Observation | null
  screenshotPath: string | null
  tracePath: string | null
  logs: LogLine[]
  hasScreenshot: boolean
  hasTrace: boolean
  label: string | null
}

export type VariantSummary = {
  experimentId: string
  variant: string
  role: RunRole | null
  samples: number
  successes: number
  failures: number
  successRate: number | null
  avgLatencyMs: number | null
  p95LatencyMs: number | null
  avgAttempts: number | null
  failureCategories: { category: string; count: number }[]
}

export type RoleSummary = {
  role: string
  samples: number
  successes: number
  successRate: number | null
  avgLatencyMs: number | null
  p95LatencyMs: number | null
}

export type MetricsSummary = {
  total: number
  successes: number
  failures: number
  errors: number
  running: number
  successRate: number | null
  avgLatencyMs: number | null
  p95LatencyMs: number | null
  byCategory: { category: string; count: number }[]
  byRole: RoleSummary[]
  variants: VariantSummary[]
}

export type PresetView = {
  id: string
  label: string
  description: string
  group: string
  experimentId: string | null
  variant: string | null
  role: RunRole | null
}

export type BrowserConfigView = {
  id: string
  label: string
  userAgent: string | null
  viewport: { width: number; height: number }
  locale: string
  timezoneId: string
}

export type ExperimentNote = {
  id: string
  experimentId: string
  variant: string
  createdAt: string
  body: Record<string, unknown>
}
