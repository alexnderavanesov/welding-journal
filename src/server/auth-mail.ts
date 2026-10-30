import nodemailer from 'nodemailer'
import { getAuthConfiguration } from './auth'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getMailConfiguration } from './auth-mail-config'
import { sendPostboxMail } from './auth-mail-postbox'

/** Local delivery writes private message files only for a loopback application. */
export async function sendAccountLink(email: string, token: string, kind: 'invite' | 'recovery') {
  const configuration = getMailConfiguration()
  const url = new URL('/account-link', getAuthConfiguration().baseURL)
  // A fragment avoids sending the secret in URLs, access logs and Referer.
  url.hash = new URLSearchParams({ token, kind }).toString()
  const mail = { from: configuration.from, to: email,
    subject: kind === 'invite' ? 'Приглашение — Учёт сварки' : 'Восстановление доступа — Учёт сварки',
    text: `${kind === 'invite' ? 'Вас пригласили в систему. Подтвердите почту и задайте пароль' : 'Администратор инициировал восстановление. Задайте новый пароль'}:\n${url}\nСсылка одноразовая и действует ${kind === 'invite' ? '48 часов' : '1 час'}. Если вы не ожидали письмо, свяжитесь с администратором.` }
  if (configuration.mode === 'postbox') return sendPostboxMail(configuration.credentials, mail)
  if (configuration.mode === 'local' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Локальный приёмник разрешён только для локального приложения.')
  }
  const transport = configuration.mode === 'local'
    ? nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' })
    : nodemailer.createTransport({ host: configuration.host, port: configuration.port, secure: true,
      auth: { user: configuration.user, pass: configuration.password }, connectionTimeout: 10000, socketTimeout: 15000 })
  try {
    const message = await transport.sendMail(mail)
    if (configuration.mode === 'local') {
      const directory = resolve(configuration.directory)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const content = 'message' in message ? message.message : undefined
      if (!Buffer.isBuffer(content)) throw new Error('Не удалось подготовить локальное письмо.')
      await writeFile(resolve(directory, `${Date.now()}-${randomUUID()}.eml`), content, { mode: 0o600, flag: 'wx' })
    }
  } finally { transport.close() }
}
