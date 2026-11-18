import { spawn } from 'node:child_process'

const api = spawn(process.execPath, ['--import', 'tsx', 'src/api/main.ts'], { stdio: 'inherit' })
const web = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--config', 'web/vite.config.ts', '--host', '0.0.0.0', '--port', '43125'],
  { stdio: 'inherit' },
)

const stop = () => {
  api.kill('SIGTERM')
  web.kill('SIGTERM')
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
api.on('exit', (code) => {
  web.kill('SIGTERM')
  if (code) process.exit(code)
})
web.on('exit', (code) => {
  if (code) process.exit(code)
})
