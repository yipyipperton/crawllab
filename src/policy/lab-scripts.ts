/** Loopback-only init scripts. None of these touch navigator.webdriver. */
export const LAB_INIT_SCRIPTS = {
  unlock: "window.__LAB_UNLOCK__='lab-unlock-7f3a';",
} as const

const ALLOWED = new Set<string>(Object.values(LAB_INIT_SCRIPTS))

export function assertLabInitScript(script: string | null, loopback: boolean): void {
  if (!script) return
  if (!loopback) {
    throw new Error('lab init scripts are only permitted on loopback targets')
  }
  if (!ALLOWED.has(script)) {
    throw new Error('lab init script is not in the allowlist')
  }
  if (/webdriver/i.test(script)) {
    throw new Error('lab init scripts must not reference webdriver')
  }
}
