import http from 'node:http'
import { writeFileSync } from 'node:fs'
writeFileSync(process.env.LIFECYCLE_PID_FILE, String(process.pid))
if (process.env.LIFECYCLE_MODE === 'startup-failure') throw new Error('Expected lifecycle startup failure')
const server = http.createServer((req, res) => {
  if (process.env.LIFECYCLE_MODE === 'startup-interrupt') res.statusCode = 503
  res.end('ready')
})
server.listen(Number(process.env.LIFECYCLE_PORT), '127.0.0.1', () => console.log('LIFECYCLE_SERVER_READY'))
process.on('SIGTERM', () => server.close(() => process.exit(0)))
