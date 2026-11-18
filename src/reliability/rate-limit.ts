export class TokenBucket {
  private tokens: number
  private updatedAt: number

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    if (capacity <= 0 || refillPerSecond <= 0) {
      throw new Error('token bucket capacity and refill rate must be positive')
    }
    this.tokens = capacity
    this.updatedAt = this.now()
  }

  private refill(): void {
    const time = this.now()
    const elapsed = Math.max(0, time - this.updatedAt)
    this.updatedAt = time
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed / 1000) * this.refillPerSecond)
  }

  async acquire(cost = 1): Promise<void> {
    if (cost > this.capacity) {
      throw new Error(`token cost ${cost} exceeds capacity ${this.capacity}`)
    }
    for (;;) {
      this.refill()
      if (this.tokens >= cost) {
        this.tokens -= cost
        return
      }
      const deficit = cost - this.tokens
      const waitMs = Math.max(1, Math.ceil((deficit / this.refillPerSecond) * 1000))
      await this.sleep(waitMs)
    }
  }
}

export class HostLimiter {
  private readonly buckets = new Map<string, TokenBucket>()

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now?: () => number,
    private readonly sleep?: (ms: number) => Promise<void>,
  ) {}

  acquire(host: string): Promise<void> {
    let bucket = this.buckets.get(host)
    if (!bucket) {
      bucket = new TokenBucket(this.capacity, this.refillPerSecond, this.now, this.sleep)
      this.buckets.set(host, bucket)
    }
    return bucket.acquire()
  }
}
