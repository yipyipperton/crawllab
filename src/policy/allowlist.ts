import { PolicyError } from './errors.js'

export function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

export function assertUrlAllowed(
  url: URL,
  cfg: { allowlistHosts: string[]; allowExternal: boolean },
): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PolicyError('allowlist', `protocol ${url.protocol} is not allowed`)
  }
  if (url.username || url.password) {
    throw new PolicyError('allowlist', 'URLs with embedded credentials are not allowed')
  }
  const host = url.hostname.toLowerCase()
  if (!cfg.allowExternal && !isLoopback(host)) {
    throw new PolicyError(
      'allowlist',
      `external host ${host} is blocked because ALLOW_EXTERNAL is not true`,
    )
  }
  const allowed = new Set(cfg.allowlistHosts.map((item) => item.toLowerCase()))
  if (!allowed.has(host)) {
    throw new PolicyError('allowlist', `host ${host} is not in ALLOWLIST_HOSTS`)
  }
}
