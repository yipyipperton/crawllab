import * as acorn from 'acorn'
import { minifyJs } from './minify.js'

type AstNode = acorn.Node & Record<string, unknown>

export type ScriptAnalysis = {
  minified: string
  minifiedBytes: number
  stringLiterals: string[]
  stringTables: { name: string; values: string[] }[]
  concatenators: string[]
  foldedCalls: string[]
  memberAccesses: string[]
  calls: string[]
  browserApis: string[]
  conditions: string[]
  limits: string[]
}

const BROWSER_HINTS = [
  'navigator',
  'document',
  'window',
  'screen',
  'canvas',
  'getContext',
  'getParameter',
  'webdriver',
  'userAgent',
]

function isNode(value: unknown): value is AstNode {
  return Boolean(value) && typeof value === 'object' && typeof (value as AstNode).type === 'string'
}

function walk(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'start' || key === 'end' || key === 'type') continue
    const value = node[key]
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isNode(child)) walk(child, visit)
      }
    } else if (isNode(value)) {
      walk(value, visit)
    }
  }
}

function isConcatFunction(node: AstNode): boolean {
  if (node.type !== 'FunctionDeclaration') return false
  const params = node.params
  if (!Array.isArray(params) || params.length !== 2) return false
  const left = params[0]
  const right = params[1]
  if (!isNode(left) || !isNode(right) || left.type !== 'Identifier' || right.type !== 'Identifier') return false
  const body = node.body
  if (!isNode(body) || body.type !== 'BlockStatement') return false
  const statements = body.body
  if (!Array.isArray(statements) || statements.length !== 1 || !isNode(statements[0])) return false
  const statement = statements[0]
  if (statement.type !== 'ReturnStatement' || !isNode(statement.argument)) return false
  const argument = statement.argument
  if (argument.type !== 'BinaryExpression' || argument.operator !== '+') return false
  return (
    isNode(argument.left) &&
    isNode(argument.right) &&
    argument.left.type === 'Identifier' &&
    argument.right.type === 'Identifier' &&
    argument.left.name === left.name &&
    argument.right.name === right.name
  )
}

export function analyzeScript(source: string): ScriptAnalysis {
  const minified = minifyJs(source)
  const program = acorn.parse(minified, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as AstNode
  const stringLiterals = new Set<string>()
  const stringTables: { name: string; values: string[] }[] = []
  const concatenators = new Set<string>()
  const foldedCalls = new Set<string>()
  const memberAccesses = new Set<string>()
  const calls = new Set<string>()
  const conditions: string[] = []

  const tables = new Map<string, string[]>()

  walk(program, (node) => {
    if (node.type === 'Literal' && typeof node.value === 'string') stringLiterals.add(node.value)
    if (node.type === 'FunctionDeclaration' && isConcatFunction(node) && isNode(node.id) && node.id.type === 'Identifier') {
      concatenators.add(String(node.id.name))
    }
    if (
      node.type === 'VariableDeclarator' &&
      isNode(node.id) &&
      node.id.type === 'Identifier' &&
      isNode(node.init) &&
      node.init.type === 'ArrayExpression' &&
      Array.isArray(node.init.elements) &&
      node.init.elements.every((element) => isNode(element) && element.type === 'Literal' && typeof element.value === 'string')
    ) {
      const values = node.init.elements.map((element) => String((element as AstNode).value))
      const name = String(node.id.name)
      tables.set(name, values)
      stringTables.push({ name, values })
    }
  })

  const resolve = (node: AstNode | null): string | null => {
    if (!node) return null
    if (node.type === 'Literal' && typeof node.value === 'string') return node.value
    if (
      node.type === 'MemberExpression' &&
      node.computed === true &&
      isNode(node.object) &&
      node.object.type === 'Identifier' &&
      isNode(node.property) &&
      node.property.type === 'Literal' &&
      typeof node.property.value === 'number'
    ) {
      const table = tables.get(String(node.object.name))
      const value = table?.[node.property.value]
      return typeof value === 'string' ? value : null
    }
    if (
      node.type === 'CallExpression' &&
      isNode(node.callee) &&
      node.callee.type === 'Identifier' &&
      concatenators.has(String(node.callee.name)) &&
      Array.isArray(node.arguments) &&
      node.arguments.length === 2 &&
      isNode(node.arguments[0]) &&
      isNode(node.arguments[1])
    ) {
      const left = resolve(node.arguments[0])
      const right = resolve(node.arguments[1])
      if (left !== null && right !== null) {
        const folded = left + right
        foldedCalls.add(folded)
        return folded
      }
    }
    return null
  }

  const formatMember = (node: AstNode): string => {
    if (node.type === 'Identifier') return String(node.name)
    if (node.type === 'Literal') return JSON.stringify(node.value)
    if (node.type === 'MemberExpression' && isNode(node.object)) {
      const object = formatMember(node.object)
      if (node.computed === true && isNode(node.property)) {
        const resolved = resolve(node.property)
        const property = resolved !== null ? JSON.stringify(resolved) : formatMember(node.property)
        return `${object}[${property}]`
      }
      if (isNode(node.property) && node.property.type === 'Identifier') {
        return `${object}.${String(node.property.name)}`
      }
    }
    if (node.type === 'CallExpression' && isNode(node.callee)) {
      resolve(node)
      return `${formatMember(node.callee)}(...)`
    }
    return node.type
  }

  walk(program, (node) => {
    if (node.type === 'MemberExpression') memberAccesses.add(formatMember(node))
    if (node.type === 'CallExpression' && isNode(node.callee)) {
      calls.add(formatMember(node.callee))
      resolve(node)
    }
    if (node.type === 'IfStatement') {
      const start = typeof node.start === 'number' ? node.start : 0
      const end = typeof node.end === 'number' ? node.end : start
      conditions.push(minified.slice(start, Math.min(end, start + 180)))
    }
  })

  const browserApis = [...memberAccesses, ...calls, ...foldedCalls, ...stringLiterals].filter((value) =>
    BROWSER_HINTS.some((hint) => value.toLowerCase().includes(hint.toLowerCase())),
  )

  return {
    minified,
    minifiedBytes: Buffer.byteLength(minified),
    stringLiterals: [...stringLiterals],
    stringTables,
    concatenators: [...concatenators],
    foldedCalls: [...foldedCalls],
    memberAccesses: [...memberAccesses],
    calls: [...calls],
    browserApis: [...new Set(browserApis)],
    conditions,
    limits: [
      'Constant folding only evaluates string tables indexed by numeric literals and functions whose body is `return a + b`.',
      'It does not execute the script and does not model the DOM.',
      'Sandbox simulation is a separate step and uses a mocked navigator. It does not change Chromium.',
    ],
  }
}
