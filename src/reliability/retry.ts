export function shouldRetry(input: {
  attempt: number
  maxRetries: number
  retryable: boolean
}): boolean {
  return input.retryable && input.attempt < input.maxRetries
}
