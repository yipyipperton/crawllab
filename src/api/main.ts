import { loadConfig } from '../config.js'
import { buildApp } from './server.js'

const config = loadConfig()
const built = await buildApp(config)
await built.app.listen({ port: config.port, host: config.host })
console.log(JSON.stringify({ event: 'listening', url: `http://127.0.0.1:${config.port}`, fixture: built.fixtureUrl }))

const shutdown = async () => {
  await built.close()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
