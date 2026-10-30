import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'

export async function sendPostboxMail(
  credentials: { accessKeyId: string; secretAccessKey: string },
  message: { from: string; to: string; subject: string; text: string },
) {
  // Explicit endpoint and credentials: never fall back to AWS or machine-wide keys.
  const client = new SESv2Client({
    endpoint: 'https://postbox.cloud.yandex.net', region: 'ru-central1', credentials,
    maxAttempts: 3, retryMode: 'standard',
  })
  try {
    const result = await client.send(new SendEmailCommand({
      FromEmailAddress: message.from,
      Destination: { ToAddresses: [message.to] },
      Content: { Simple: {
        Subject: { Data: message.subject, Charset: 'UTF-8' },
        Body: { Text: { Data: message.text, Charset: 'UTF-8' } },
      } },
    }), { abortSignal: AbortSignal.timeout(15000) })
    if (!result.MessageId?.trim()) throw new Error('Missing message ID')
  } catch {
    // Provider errors may contain message content, activation links or credentials.
    throw new Error('Postbox не подтвердил приём письма. Проверьте подключение, ключ, домен отправителя и квоты.')
  } finally {
    client.destroy()
  }
}
