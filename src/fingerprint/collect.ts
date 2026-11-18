import type { Page } from 'playwright'
import type { FingerprintSignals } from '../shared/types.js'
import type { BrowserVersionInfo } from '../engine/pool.js'

const COLLECT_EXPRESSION = `(() => {
  function glInfo() {
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl');
      if (!gl) return { vendor: null, renderer: null };
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        return {
          vendor: String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)),
          renderer: String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
        };
      }
      return {
        vendor: String(gl.getParameter(gl.VENDOR)),
        renderer: String(gl.getParameter(gl.RENDERER))
      };
    } catch (error) {
      return { vendor: 'error', renderer: 'error' };
    }
  }
  var stack = null;
  try { throw new Error('crawllab-stack-probe'); } catch (error) {
    stack = error && error.stack ? String(error.stack).slice(0, 400) : null;
  }
  var descriptor = null;
  try {
    descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
  } catch (error) { descriptor = null; }
  var gl = glInfo();
  return {
    userAgent: navigator.userAgent,
    webdriver: navigator.webdriver === true ? true : navigator.webdriver === false ? false : null,
    language: navigator.language || null,
    languages: Array.from(navigator.languages || []),
    platform: navigator.platform || null,
    vendor: navigator.vendor || null,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemory: navigator.deviceMemory || null,
    maxTouchPoints: navigator.maxTouchPoints,
    pluginsLength: navigator.plugins ? navigator.plugins.length : null,
    pdfViewerEnabled: typeof navigator.pdfViewerEnabled === 'boolean' ? navigator.pdfViewerEnabled : null,
    cookieEnabled: navigator.cookieEnabled,
    webdriverOnPrototype: Boolean(descriptor),
    screen: { width: screen.width, height: screen.height, colorDepth: screen.colorDepth },
    viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    hasChromeObject: typeof window.chrome !== 'undefined',
    webglVendor: gl.vendor,
    webglRenderer: gl.renderer,
    errorStackSample: stack
  };
})()`

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

export async function collectFingerprint(page: Page, version: BrowserVersionInfo | null): Promise<FingerprintSignals> {
  const raw = asRecord(await page.evaluate(COLLECT_EXPRESSION))
  let headers: Record<string, string> = {}
  try {
    const echoed = asRecord(await page.evaluate(`(async () => {
      const response = await fetch('/api/echo-headers');
      return await response.json();
    })()`))
    const headerRecord = asRecord(echoed.headers)
    headers = Object.fromEntries(
      Object.entries(headerRecord).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    headers = {}
  }
  const screen = asRecord(raw.screen)
  const viewport = asRecord(raw.viewport)
  const userAgent = str(raw.userAgent) ?? ''
  return {
    userAgent,
    webdriver: bool(raw.webdriver),
    language: str(raw.language),
    languages: Array.isArray(raw.languages) ? raw.languages.map((item) => String(item)) : [],
    platform: str(raw.platform),
    vendor: str(raw.vendor),
    hardwareConcurrency: num(raw.hardwareConcurrency),
    deviceMemory: num(raw.deviceMemory),
    maxTouchPoints: num(raw.maxTouchPoints),
    pluginsLength: num(raw.pluginsLength),
    pdfViewerEnabled: bool(raw.pdfViewerEnabled),
    cookieEnabled: bool(raw.cookieEnabled),
    webdriverOnPrototype: bool(raw.webdriverOnPrototype),
    screen:
      num(screen.width) === null
        ? null
        : { width: num(screen.width) ?? 0, height: num(screen.height) ?? 0, colorDepth: num(screen.colorDepth) ?? 0 },
    viewport:
      num(viewport.innerWidth) === null
        ? null
        : {
            innerWidth: num(viewport.innerWidth) ?? 0,
            innerHeight: num(viewport.innerHeight) ?? 0,
            devicePixelRatio: num(viewport.devicePixelRatio) ?? 0,
          },
    timezone: str(raw.timezone),
    hasChromeObject: bool(raw.hasChromeObject),
    webglVendor: str(raw.webglVendor),
    webglRenderer: str(raw.webglRenderer),
    errorStackSample: str(raw.errorStackSample),
    headlessTokenInUa: /HeadlessChrome/i.test(userAgent),
    cdpBrowser: version?.product ?? null,
    cdpProtocolVersion: version?.protocolVersion ?? null,
    cdpUserAgent: version?.userAgent ?? null,
    cdpJsVersion: version?.jsVersion ?? null,
    requestHeaders: headers,
  }
}
