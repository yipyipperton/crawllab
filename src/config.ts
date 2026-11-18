import fs from 'node:fs'
import path from 'node:path'

export type AppConfig = {
  host: string
  port: number
  fixturePort: number
  databasePath: string
  artifactDir: string
  headless: boolean
  browserChannel: string | undefined
  browserConcurrency: number
  defaultTimeoutMs: number
  logLevel: string
  allowlistHosts: string[]
  allowExternal: boolean
  botUserAgent: string
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function loadEnvFile(file = '.env'): void {
  const full = path.resolve(file)
  if (!fs.existsSync(full)) return
  const text = fs.readFileSync(full, 'utf8')
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index === -1) continue
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  loadEnvFile()
  const root = process.cwd()
  return {
    host: env.HOST ?? '0.0.0.0',
    port: num(env.PORT, 43123),
    fixturePort: num(env.FIXTURE_PORT, 43124),
    databasePath: path.resolve(root, env.DATABASE_PATH ?? 'data/crawllab.sqlite'),
    artifactDir: path.resolve(root, env.ARTIFACT_DIR ?? 'data/artifacts'),
    headless: env.HEADLESS !== 'false',
    browserChannel: env.BROWSER_CHANNEL?.trim() ? env.BROWSER_CHANNEL.trim() : undefined,
    browserConcurrency: Math.max(1, num(env.BROWSER_CONCURRENCY, 2)),
    defaultTimeoutMs: num(env.DEFAULT_TIMEOUT_MS, 15_000),
    logLevel: env.LOG_LEVEL ?? 'info',
    allowlistHosts: (env.ALLOWLIST_HOSTS ?? '127.0.0.1,localhost')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
    allowExternal: env.ALLOW_EXTERNAL === 'true',
    botUserAgent: env.BOT_USER_AGENT ?? 'CrawlLabBot/1.0',
  }
}
