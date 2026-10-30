type Environment = Record<string, string | undefined>

function required(env: Environment, name: string) {
  const value = env[name]
  if (!value || value.trim() !== value || /\s/.test(value)) {
    throw new Error(`Проверьте настройку почты ${name}.`)
  }
  return value
}

export function getMailConfiguration(env: Environment = process.env) {
  const mode = env.AUTH_MAIL_MODE ?? 'local'
  const from = env.AUTH_MAIL_FROM ?? 'system@yums.ru'
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)) throw new Error('Укажите корректный AUTH_MAIL_FROM.')
  if (mode === 'postbox') {
    return { mode, from, credentials: {
      accessKeyId: required(env, 'POSTBOX_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'POSTBOX_SECRET_ACCESS_KEY'),
    } } as const
  }
  if (mode === 'local') {
    if (!['127.0.0.1', 'localhost', '::1'].includes(env.SMTP_HOST ?? '127.0.0.1')) {
      throw new Error('Локальная почта должна использовать локальный приёмник.')
    }
    return { mode, from, directory: env.AUTH_MAIL_LOCAL_DIR ?? 'data/auth-mail' } as const
  }
  if (mode === 'smtp') {
    const port = Number(env.SMTP_PORT ?? 465)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Проверьте настройку почты SMTP_PORT.')
    return { mode, from, host: required(env, 'SMTP_HOST'), port,
      user: required(env, 'SMTP_USER'), password: required(env, 'SMTP_PASSWORD') } as const
  }
  throw new Error('Не настроен способ доставки писем.')
}

export function assertServerMailConfiguration(env: Environment = process.env) {
  const configuration = getMailConfiguration(env)
  if (configuration.mode === 'local') throw new Error('Для серверного владельца настройте доставку SMTP или Postbox. Для локальной работы используйте prepare-local-owner.ts.')
  return configuration
}
