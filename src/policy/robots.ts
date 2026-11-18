type Rule = { allow: boolean; path: string }
type Group = { agents: string[]; rules: Rule[] }

export function parseRobots(
  text: string,
  pathname: string,
  userAgent: string,
): { allowed: boolean; matchedRule: string } {
  const groups: Group[] = []
  let current: Group | null = null
  const ensure = (): Group => {
    if (!current) {
      current = { agents: [], rules: [] }
      groups.push(current)
    }
    return current
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0]?.trim() ?? ''
    if (!line) continue
    const index = line.indexOf(':')
    if (index === -1) continue
    const key = line.slice(0, index).trim().toLowerCase()
    const value = line.slice(index + 1).trim()
    if (key === 'user-agent') {
      if (current && current.rules.length > 0) {
        current = { agents: [value.toLowerCase()], rules: [] }
        groups.push(current)
      } else {
        ensure().agents.push(value.toLowerCase())
      }
    } else if ((key === 'allow' || key === 'disallow') && value) {
      ensure().rules.push({ allow: key === 'allow', path: value })
    }
  }

  const ua = userAgent.toLowerCase()
  const specific = groups.filter((group) => group.agents.some((agent) => agent !== '*' && ua.includes(agent)))
  const star = groups.filter((group) => group.agents.includes('*'))
  const rules = (specific.length > 0 ? specific : star).flatMap((group) => group.rules)

  let best: { len: number; allow: boolean; rule: string } | null = null
  for (const rule of rules) {
    if (!(pathname === rule.path || pathname.startsWith(rule.path))) continue
    const candidate = {
      len: rule.path.length,
      allow: rule.allow,
      rule: `${rule.allow ? 'Allow' : 'Disallow'}: ${rule.path}`,
    }
    if (
      !best ||
      candidate.len > best.len ||
      (candidate.len === best.len && candidate.allow && !best.allow)
    ) {
      best = candidate
    }
  }

  if (!best) return { allowed: true, matchedRule: 'no matching rule' }
  return { allowed: best.allow, matchedRule: best.rule }
}

export async function checkRobots(
  url: URL,
  userAgent: string,
  timeoutMs = 5_000,
): Promise<{ allowed: boolean; reason: string }> {
  const robotsUrl = new URL('/robots.txt', url)
  try {
    const response = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': userAgent },
    })
    if (response.status === 404) return { allowed: true, reason: 'no robots.txt (404)' }
    if (!response.ok) {
      return {
        allowed: false,
        reason: `robots.txt returned HTTP ${response.status}; blocked fail-closed`,
      }
    }
    const decision = parseRobots(await response.text(), url.pathname, userAgent)
    return { allowed: decision.allowed, reason: decision.matchedRule }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      allowed: false,
      reason: `robots.txt could not be fetched (${message}); blocked fail-closed`,
    }
  }
}
