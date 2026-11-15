// Run in the application's environment. No .env loading: the repository may
// contain obsolete remote credentials, while the operator targets this server.
const token = process.env.MAINTENANCE_TOKEN?.trim()
const port = Number(process.env.PORT || 3000)
if (!token) throw new Error('MAINTENANCE_TOKEN is not configured')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
const response = await fetch(`http://127.0.0.1:${port}/api/maintenance/dispatcher-prewarm`, {
  method: 'POST', headers: { authorization: `Bearer ${token}` },
})
const result = await response.json()
console.log(JSON.stringify(result))
if (!response.ok || result.ready !== true) process.exitCode = 1
