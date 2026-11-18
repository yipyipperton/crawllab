export class PolicyError extends Error {
  readonly code: 'allowlist' | 'robots'

  constructor(code: 'allowlist' | 'robots', message: string) {
    super(message)
    this.name = 'PolicyError'
    this.code = code
  }
}
