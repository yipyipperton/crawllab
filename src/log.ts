import type { LogLine } from './shared/types.js'

export type { LogLine }

export function logLine(
  level: LogLine['level'],
  message: string,
  data?: Record<string, unknown>,
): LogLine {
  return { at: new Date().toISOString(), level, message, data }
}
