/** Whitespace and comment minifier. It does not rename bindings. Obfuscation lives in the fixture. */
export function minifyJs(code: string): string {
  let out = ''
  let i = 0
  while (i < code.length) {
    const ch = code[i] ?? ''
    const next = code[i + 1] ?? ''
    if (ch === '/' && next === '/') {
      i += 2
      while (i < code.length && code[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      out += ch
      i += 1
      while (i < code.length) {
        const current = code[i] ?? ''
        out += current
        if (current === '\\') {
          i += 1
          if (i < code.length) out += code[i]
          i += 1
          continue
        }
        i += 1
        if (current === quote) break
      }
      continue
    }
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      let j = i + 1
      while (j < code.length && /\s/.test(code[j] ?? '')) j += 1
      const prev = out[out.length - 1] ?? ''
      const upcoming = code[j] ?? ''
      if (/[A-Za-z0-9_$]/.test(prev) && /[A-Za-z0-9_$]/.test(upcoming)) out += ' '
      i += 1
      continue
    }
    out += ch
    i += 1
  }
  return out.trim()
}
