import { chromium, type Browser, type BrowserContext } from 'playwright'
import type { BrowserConfig } from './configs.js'
import { logLine, type LogLine } from '../log.js'

export type BrowserVersionInfo = {
  product: string | null
  protocolVersion: string | null
  userAgent: string | null
  jsVersion: string | null
}

export class BrowserPool {
  private browser: Browser | null = null
  channel = 'unlaunched'
  versionInfo: BrowserVersionInfo | null = null
  private readonly logs: LogLine[] = []

  constructor(private readonly preferredChannel: string | undefined) {}

  private note(level: LogLine['level'], message: string, data?: Record<string, unknown>): void {
    const line = logLine(level, message, data)
    this.logs.push(line)
    const payload = JSON.stringify({ ts: line.at, level, message, ...data })
    if (level === 'error') console.error(payload)
    else console.log(payload)
  }

  async launch(): Promise<void> {
    const args = ['--disable-dev-shm-usage']
    if (this.preferredChannel) {
      this.browser = await chromium.launch({ headless: true, channel: this.preferredChannel, args })
      this.channel = this.preferredChannel
    } else {
      try {
        this.browser = await chromium.launch({ headless: true, args })
        this.channel = 'chromium'
      } catch (error) {
        this.note('warn', 'bundled Chromium failed to launch; trying system Chrome', {
          error: error instanceof Error ? error.message : String(error),
        })
        this.browser = await chromium.launch({ headless: true, channel: 'chrome', args })
        this.channel = 'chrome'
      }
    }
    try {
      const session = await this.browser.newBrowserCDPSession()
      const version = await session.send('Browser.getVersion')
      this.versionInfo = {
        product: version.product ?? null,
        protocolVersion: version.protocolVersion ?? null,
        userAgent: version.userAgent ?? null,
        jsVersion: version.jsVersion ?? null,
      }
      await session.detach()
    } catch (error) {
      this.note('warn', 'CDP Browser.getVersion failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    this.note('info', 'browser launched', { channel: this.channel, version: this.versionInfo })
  }

  async withContext<T>(config: BrowserConfig, fn: (context: BrowserContext) => Promise<T>): Promise<T> {
    const browser = await this.ensure()
    const context = await browser.newContext({
      ...(config.userAgent ? { userAgent: config.userAgent } : {}),
      viewport: config.viewport,
      locale: config.locale,
      timezoneId: config.timezoneId,
    })
    try {
      return await fn(context)
    } catch (error) {
      if (!browser.isConnected()) await this.safeClose()
      throw error
    } finally {
      await context.close().catch(() => undefined)
    }
  }

  private async ensure(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser
    await this.launch()
    if (!this.browser) throw new Error('browser failed to launch')
    return this.browser
  }

  async close(): Promise<void> {
    await this.safeClose()
  }

  private async safeClose(): Promise<void> {
    const browser = this.browser
    this.browser = null
    if (browser) await browser.close().catch(() => undefined)
  }
}
