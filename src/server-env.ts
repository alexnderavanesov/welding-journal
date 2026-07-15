import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from 'dotenv'

const ENV_LOADED_FLAG = 'WELDING_ENV_LOADED'

export function loadServerEnv() {
  if (process.env[ENV_LOADED_FLAG] === '1') return
  process.env[ENV_LOADED_FLAG] = '1'

  if (process.env.NODE_ENV === 'production') return

  for (const filename of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), filename)
    if (existsSync(path)) {
      config({ path, override: false })
    }
  }
}
