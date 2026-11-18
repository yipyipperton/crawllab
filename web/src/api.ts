import { useEffect, useState } from 'react'

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json() as Promise<T>
}

export function useApi<T>(path: string | null, intervalMs = 0): {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(path))
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    const load = async () => {
      try {
        const json = await getJson<T>(path)
        if (!cancelled) {
          setData(json)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    if (!intervalMs) return () => { cancelled = true }
    const timer = setInterval(() => void load(), intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [path, intervalMs, tick])

  return { data, error, loading, reload: () => setTick((value) => value + 1) }
}
