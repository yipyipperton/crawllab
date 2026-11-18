import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  url TEXT NOT NULL,
  final_url TEXT,
  status TEXT NOT NULL,
  role TEXT,
  experiment_id TEXT,
  variant TEXT,
  label TEXT,
  browser_config_id TEXT,
  wait_strategy TEXT,
  selector TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  navigation_ms INTEGER,
  extraction_ms INTEGER,
  http_status INTEGER,
  error_message TEXT,
  extracted_text TEXT,
  diagnostics_json TEXT NOT NULL DEFAULT '{}',
  evidence_json TEXT,
  screenshot_path TEXT,
  trace_path TEXT,
  logs_json TEXT NOT NULL DEFAULT '[]',
  request_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at);
CREATE INDEX IF NOT EXISTS idx_runs_experiment ON runs(experiment_id, variant);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

CREATE TABLE IF NOT EXISTS fingerprint_observations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  config_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  signals_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiment_notes (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  created_at TEXT NOT NULL,
  body_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export function openDatabase(file: string): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(SCHEMA)
  return db
}
