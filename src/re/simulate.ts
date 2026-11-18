import vm from 'node:vm'

export type WebdriverSim = 'true' | 'false' | 'absent'

export type GateSimulation = {
  webdriver: WebdriverSim
  token: boolean
  mode: string | null
  text: string | null
  challenge: string | null
  reason: string | null
  error: string | null
}

export function simulateGate(code: string, input: { webdriver: WebdriverSim; token: boolean }): GateSimulation {
  const element = {
    attrs: {} as Record<string, string>,
    textContent: '',
    setAttribute(key: string, value: string) {
      this.attrs[key] = String(value)
    },
  }
  const document = {
    readyState: 'complete',
    getElementById(id: string) {
      return id === 'gate-result' ? element : null
    },
    createElement() {
      return {
        getContext(kind: string) {
          if (kind !== 'webgl') return null
          return {
            VENDOR: 0x1f00,
            getParameter() {
              return 'MockVendor'
            },
          }
        },
      }
    },
    addEventListener() {},
  }
  const navigator: Record<string, unknown> = {
    userAgent: 'SimulatedNavigator',
    plugins: { length: 1 },
    language: 'en-US',
  }
  if (input.webdriver === 'true') navigator.webdriver = true
  if (input.webdriver === 'false') navigator.webdriver = false
  const window: Record<string, unknown> = {
    navigator,
    document,
    chrome: {},
    innerWidth: 1280,
    innerHeight: 720,
  }
  if (input.token) window.__LAB_UNLOCK__ = 'lab-unlock-7f3a'
  try {
    vm.runInNewContext(code, { navigator, document, window, console }, { timeout: 1000 })
    return {
      webdriver: input.webdriver,
      token: input.token,
      mode: element.attrs['data-mode'] ?? null,
      text: element.textContent || null,
      challenge: element.attrs['data-crawllab-challenge'] ?? null,
      reason: element.attrs['data-reason'] ?? null,
      error: null,
    }
  } catch (error) {
    return {
      webdriver: input.webdriver,
      token: input.token,
      mode: null,
      text: null,
      challenge: null,
      reason: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function simulateMatrix(code: string): GateSimulation[] {
  const cases: Array<{ webdriver: WebdriverSim; token: boolean }> = [
    { webdriver: 'true', token: false },
    { webdriver: 'false', token: false },
    { webdriver: 'absent', token: false },
    { webdriver: 'true', token: true },
    { webdriver: 'false', token: true },
    { webdriver: 'absent', token: true },
  ]
  return cases.map((item) => simulateGate(code, item))
}
