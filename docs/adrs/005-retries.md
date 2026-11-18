# ADR 005: What retries are allowed to fix

## Status

Accepted.

## Decision

A failure is retryable when it is a timeout, a network error, HTTP 429, or HTTP 5xx, or when the page's error selector matched. A missing selector is not retryable unless the job sets `retryOnMiss`. HTTP 401, 403, and 404 are not retryable. Allowlist and robots rejections are not retried.

Backoff is equal jitter: half the exponential delay plus a random half, capped. The host token bucket is optional and shared across the jobs of one batch. It is not a global limiter, because a fingerprint run should not wait behind a pacing experiment.

## Consequences

Case A enables `retryOnMiss` on the early read to show that retries do not create a node. Case C's short timeout is retryable and still fails, because every attempt is shorter than the timer. Case C's injected 500 is retryable and the next sequence number is not the same failure. The overload retry batch keeps the high concurrency, which is the wrong knob.
