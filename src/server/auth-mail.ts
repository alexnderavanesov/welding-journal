import nodemailer from 'nodemailer'
import { getAuthConfiguration } from './auth'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Local delivery is restricted to a loopback SMTP sink, including production builds. */
export async function sendAccountLink(email: string, token: string, kind: 'invite' | 'recovery') {
  const mode = process.env.AUTH_MAIL_MODE ?? 'local'
  const host = process.env.SMTP_HOST ?? '127.0.0.1'
  if (mode === 'local' && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Локальная почта должна использовать локальный приёмник.')
  if (!['local', 'smtp'].includes(mode)) throw new Error('Не настроен способ доставки писем.')
  const transport = mode === 'local' ? nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' }) : nodemailer.createTransport({ host, port: Number(process.env.SMTP_PORT ?? 465),
    secure: mode === 'smtp', ...(mode === 'smtp' ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
    connectionTimeout: 10000, socketTimeout: 15000 })
  const url = new URL('/account-link', getAuthConfiguration().baseURL)
  // A fragment avoids sending the secret in URLs, access logs and Referer.
  url.hash = new URLSearchParams({ token, kind }).toString()
  try {
    const message = await transport.sendMail({ from: process.env.AUTH_MAIL_FROM ?? 'system@yums.ru', to: email,
      subject: kind === 'invite' ? 'Приглашение — Учёт сварки' : 'Восстановление доступа — Учёт сварки',
      text: `${kind === 'invite' ? 'Вас пригласили в систему. Подтвердите почту и задайте пароль' : 'Администратор инициировал восстановление. Задайте новый пароль'}:\n${url}\nСсылка одноразовая и действует ${kind === 'invite' ? '48 часов' : '1 час'}. Если вы не ожидали письмо, свяжитесь с администратором.` })
    if (mode === 'local') {
      if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(getAuthConfiguration().baseURL).hostname)) throw new Error('Локальный приёмник разрешён только для локального приложения.')
      const directory = resolve(process.env.AUTH_MAIL_LOCAL_DIR ?? 'data/auth-mail')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const content = 'message' in message ? message.message : undefined
      if (!Buffer.isBuffer(content)) throw new Error('Не удалось подготовить локальное письмо.')
      await writeFile(resolve(directory, `${Date.now()}-${randomUUID()}.eml`), content, { mode: 0o600, flag: 'wx' })
    }
  } finally { transport.close() }
}
