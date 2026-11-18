import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  DiagnosticReport,
  ExperimentNote,
  FingerprintSignals,
  LogLine,
  Observation,
  ResolvedJob,
  RunRecord,
  RunRole,
  RunStatus,
} from '../shared/types.js'
import { nowIso, parseJson } from '../util.js'

type RunRow = {
  id: string
  created_at: string
  started_at: string | null
  finished_at: string | null
  url: string
  final_url: string | null
  status: string
  role: string | null
  experiment_id: string | null
  variant: string | null
  label: string | null
  browser_config_id: string | null
  wait_strategy: string | null
  selector: string | null
  attempt_count: number
  duration_ms: number | null
  navigation_ms: number | null
  extraction_ms: number | null
  http_status: number | null
  error_message: string | null
  extracted_text: string | null
  diagnostics_json: string
  evidence_json: string | null
  screenshot_path: string | null
  trace_path: string | null
  logs_json: string
  request_json: string
}

const EMPTY_REPORT: DiagnosticReport = {
  summary: 'Queued.',
  primaryCategory: 'pending',
  findings: [],
}

function mapRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    url: row.url,
    finalUrl: row.final_url,
    status: row.status as RunStatus,
    role: (row.role as RunRole | null) ?? null,
    experimentId: row.experiment_id,
    variant: row.variant,
    browserConfigId: row.browser_config_id,
    waitStrategy: row.wait_strategy,
    selector: row.selector,
    attemptCount: row.attempt_count,
    durationMs: row.duration_ms,
    navigationMs: row.navigation_ms,
    extractionMs: row.extraction_ms,
    httpStatus: row.http_status,
    errorMessage: row.error_message,
    extractedText: row.extracted_text,
    diagnostics: parseJson(row.diagnostics_json, EMPTY_REPORT),
    evidence: parseJson<Observation | null>(row.evidence_json, null),
    screenshotPath: row.screenshot_path,
    tracePath: row.trace_path,
    logs: parseJson<LogLine[]>(row.logs_json, []),
    hasScreenshot: Boolean(row.screenshot_path),
    hasTrace: Boolean(row.trace_path),
    label: row.label,
  }
}

export class Repo {
  constructor(private readonly db: DatabaseSync) {}

  insertQueued(job: ResolvedJob): void {
    const now = nowIso()
    this.db
      .prepare(
        `INSERT INTO runs (
          id, created_at, url, status, role, experiment_id, variant, label, browser_config_id,
          wait_strategy, selector, attempt_count, diagnostics_json, logs_json, request_json
        ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, 0, ?, '[]', ?)`,
      )
      .run(
        job.id,
        now,
        job.url,
        job.role,
        job.experimentId,
        job.variant,
        job.label,
        job.browserConfigId,
        job.waitStrategy,
        job.selector,
        JSON.stringify(EMPTY_REPORT),
        JSON.stringify(job),
      )
  }

  getJob(id: string): ResolvedJob | null {
    const row = this.db.prepare('SELECT request_json FROM runs WHERE id = ?').get(id) as
      | { request_json: string }
      | undefined
    if (!row) return null
    return parseJson<ResolvedJob | null>(row.request_json, null)
  }

  markRunning(id: string): void {
    this.db.prepare(`UPDATE runs SET status = 'running', started_at = ? WHERE id = ?`).run(nowIso(), id)
  }

  finish(
    id: string,
    input: {
      status: 'success' | 'failed'
      observation: Observation
      diagnostics: DiagnosticReport
      screenshotPath: string | null
      tracePath: string | null
      logs: LogLine[]
    },
  ): void {
    this.db
      .prepare(
        `UPDATE runs SET
          status = ?, finished_at = ?, final_url = ?, attempt_count = ?, duration_ms = ?, navigation_ms = ?,
          extraction_ms = ?, http_status = ?, error_message = ?, extracted_text = ?, diagnostics_json = ?,
          evidence_json = ?, screenshot_path = ?, trace_path = ?, logs_json = ?
        WHERE id = ?`,
      )
      .run(
        input.status,
        nowIso(),
        input.observation.finalUrl,
        input.observation.attempts.length,
        input.observation.durationMs,
        input.observation.navigationMs,
        input.observation.extractionMs,
        input.observation.httpStatus,
        input.observation.navigationError ??
          input.observation.selectorWaitError ??
          input.observation.failFastText,
        input.observation.extractedText,
        JSON.stringify(input.diagnostics),
        JSON.stringify(input.observation),
        input.screenshotPath,
        input.tracePath,
        JSON.stringify(input.logs),
        id,
      )
  }

  markError(id: string, error: unknown, logs: LogLine[] = []): void {
    const message = error instanceof Error ? error.message : String(error)
    const report: DiagnosticReport = {
      summary: message,
      primaryCategory: 'worker_error',
      findings: [
        {
          code: 'worker_error',
          title: 'Worker error',
          severity: 'failure',
          confidence: 'high',
          probableCause: 'The worker threw before it could finish the attempt. The browser pool relaunches on the next job if the browser disconnected.',
          investigation: ['Read the error message. A closed target is retried by the pool on the following job, not inside the crashed attempt.'],
          evidence: [{ source: 'exception', detail: message }],
        },
      ],
    }
    this.db
      .prepare(
        `UPDATE runs SET status = 'error', finished_at = ?, error_message = ?, diagnostics_json = ?, logs_json = ? WHERE id = ?`,
      )
      .run(nowIso(), message, JSON.stringify(report), JSON.stringify(logs), id)
  }

  getRun(id: string): RunRecord | null {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined
    return row ? mapRun(row) : null
  }

  listRuns(filter: {
    status?: string
    experimentId?: string
    variant?: string
    role?: string
    limit: number
    offset: number
  }): { runs: RunRecord[]; total: number } {
    const where: string[] = []
    const params: Array<string | number> = []
    if (filter.status) {
      where.push('status = ?')
      params.push(filter.status)
    }
    if (filter.experimentId) {
      where.push('experiment_id = ?')
      params.push(filter.experimentId)
    }
    if (filter.variant) {
      where.push('variant = ?')
      params.push(filter.variant)
    }
    if (filter.role) {
      where.push('role = ?')
      params.push(filter.role)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = this.db.prepare(`SELECT COUNT(*) AS count FROM runs ${clause}`).get(...params) as { count: number }
    const rows = this.db
      .prepare(`SELECT * FROM runs ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, filter.limit, filter.offset) as RunRow[]
    return { runs: rows.map(mapRun), total: Number(total.count) }
  }

  allRuns(): RunRecord[] {
    const rows = this.db.prepare('SELECT * FROM runs ORDER BY created_at ASC').all() as RunRow[]
    return rows.map(mapRun)
  }

  recoverStale(): number {
    const result = this.db
      .prepare(
        `UPDATE runs SET status = 'error', finished_at = ?, error_message = ?, diagnostics_json = ?
         WHERE status IN ('queued', 'running')`,
      )
      .run(
        nowIso(),
        'worker interrupted before completion',
        JSON.stringify({
          summary: 'worker interrupted before completion',
          primaryCategory: 'worker_error',
          findings: [
            {
              code: 'worker_error',
              title: 'Worker interrupted',
              severity: 'failure',
              confidence: 'high',
              probableCause: 'The process stopped while this run was queued or running. It was marked failed on the next startup.',
              investigation: ['Re-run the preset. The previous attempt did not finish and its evidence may be incomplete.'],
              evidence: [{ source: 'startup', detail: 'status was queued or running when the API started' }],
            },
          ],
        } satisfies DiagnosticReport),
      )
    return Number(result.changes)
  }

  insertFingerprint(runId: string, configId: string, signals: FingerprintSignals): void {
    this.db
      .prepare(
        `INSERT INTO fingerprint_observations (id, run_id, config_id, captured_at, signals_json) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), runId, configId, nowIso(), JSON.stringify(signals))
  }

  listFingerprints(): Array<{
    id: string
    runId: string
    configId: string
    capturedAt: string
    signals: FingerprintSignals
  }> {
    const rows = this.db
      .prepare(
        'SELECT id, run_id, config_id, captured_at, signals_json FROM fingerprint_observations ORDER BY captured_at ASC',
      )
      .all() as Array<{ id: string; run_id: string; config_id: string; captured_at: string; signals_json: string }>
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      configId: row.config_id,
      capturedAt: row.captured_at,
      signals: parseJson(row.signals_json, {} as FingerprintSignals),
    }))
  }

  insertNote(experimentId: string, variant: string, body: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT INTO experiment_notes (id, experiment_id, variant, created_at, body_json) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), experimentId, variant, nowIso(), JSON.stringify(body))
  }

  listNotes(): ExperimentNote[] {
    const rows = this.db
      .prepare('SELECT id, experiment_id, variant, created_at, body_json FROM experiment_notes ORDER BY created_at ASC')
      .all() as Array<{ id: string; experiment_id: string; variant: string; created_at: string; body_json: string }>
    return rows.map((row) => ({
      id: row.id,
      experimentId: row.experiment_id,
      variant: row.variant,
      createdAt: row.created_at,
      body: parseJson(row.body_json, {}),
    }))
  }

  setMeta(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, JSON.stringify(value))
  }

  getMeta<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return null
    return parseJson<T | null>(row.value, null)
  }

  resetAll(): void {
    this.db.exec('DELETE FROM fingerprint_observations')
    this.db.exec('DELETE FROM experiment_notes')
    this.db.exec('DELETE FROM runs')
    this.db.exec('DELETE FROM meta')
  }
}
