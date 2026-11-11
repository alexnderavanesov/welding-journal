import { createSchemeFileStore, lineSchemeStorageDirectory, type SchemeFileStore } from './line-scheme-files'

export type SchemeS3Config = { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }

/** Explicit credentials only: never fall back to another AWS profile or instance role. */
export function readSchemeS3Config(env: Record<string, string | undefined>, prefix = 'LINE_SCHEME_S3'): SchemeS3Config {
  const value = (name: string) => env[`${prefix}_${name}`]?.trim() ?? ''
  const config = { endpoint: value('ENDPOINT'), region: value('REGION'), bucket: value('BUCKET'),
    accessKeyId: value('ACCESS_KEY_ID'), secretAccessKey: value('SECRET_ACCESS_KEY') }
  let endpoint: URL
  try { endpoint = new URL(config.endpoint) } catch { throw new Error('Не настроен HTTPS endpoint хранилища PDF.') }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' || endpoint.port) {
    throw new Error('Для хранилища PDF нужен HTTPS endpoint без пути и параметров.')
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket) || !/^[a-z0-9-]+$/.test(config.region)) {
    throw new Error('Не настроены бакет или регион хранилища PDF. Для vHosted укажите имя бакета без точек.')
  }
  if (!config.accessKeyId || !config.secretAccessKey || /\s/.test(config.accessKeyId + config.secretAccessKey)) {
    throw new Error('Не настроены ключи доступа к хранилищу PDF.')
  }
  config.endpoint = endpoint.origin
  return config
}

let cachedS3: { signature: string; store: Promise<SchemeFileStore> } | undefined

export async function getSchemeFileStore(): Promise<SchemeFileStore> {
  const driver = process.env.LINE_SCHEME_STORAGE_DRIVER?.trim() || 'local'
  if (driver === 'local') return createSchemeFileStore(lineSchemeStorageDirectory())
  if (driver !== 's3') throw new Error('Неизвестный способ хранения PDF.')
  const config = readSchemeS3Config(process.env), signature = JSON.stringify(config)
  if (cachedS3?.signature !== signature) {
    const store = import('./line-scheme-s3').then(({ createS3SchemeFileStore }) => createS3SchemeFileStore(config))
    cachedS3 = { signature, store }
    store.catch(() => { if (cachedS3?.signature === signature) cachedS3 = undefined })
  }
  return cachedS3.store
}
