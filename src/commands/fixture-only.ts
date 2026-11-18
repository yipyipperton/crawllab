import { loadConfig } from '../config.js'
import { createFixtureServer } from '../fixtures/server.js'

const config = loadConfig()
const fixture = await createFixtureServer(config.fixturePort)
console.log(JSON.stringify({ url: fixture.url }))
const close = async () => {
  await fixture.close()
  process.exit(0)
}
process.on('SIGINT', () => void close())
process.on('SIGTERM', () => void close())
