import type { BrowserConfigView } from '../shared/types.js'

export type BrowserConfig = BrowserConfigView

export const browserConfigs: Record<string, BrowserConfig> = {
  'stock-headless': {
    id: 'stock-headless',
    label: 'Stock Playwright Chromium headless',
    userAgent: null,
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },
  'custom-ua-viewport': {
    id: 'custom-ua-viewport',
    label: 'Custom UA, de-DE, 1920×1080, Europe/Berlin',
    userAgent: 'CrawlLabResearch/1.0 (config=custom-ua) Chrome/131.0.0.0',
    viewport: { width: 1920, height: 1080 },
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },
}

export function getBrowserConfig(id: string): BrowserConfig {
  const config = browserConfigs[id]
  if (!config) throw new Error(`unknown browser config ${id}`)
  return config
}

export function listBrowserConfigs(): BrowserConfig[] {
  return Object.values(browserConfigs)
}
