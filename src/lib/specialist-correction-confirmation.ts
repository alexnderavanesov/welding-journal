import type { ConfirmAction } from './confirm-action-context'

export async function withSpecialistCorrectionConfirmation<T>(run: (confirmation?: string) => Promise<T>, confirm: ConfirmAction): Promise<T> {
  try { return await run() }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const token = message.match(/\[specialist-confirmation:([a-f0-9]{64})\]/)?.[1]
    if (!token) throw error
    const accepted = await confirm({ title: 'Очистить специалистов при объединении?', description: message.replace(/ \[specialist-confirmation:.*\]/, ''),
      warning: 'Сохранённые ФИО и удостоверения обеих ролей будут убраны только из объединённых заключений.', confirmLabel: 'Сохранить и очистить роли' })
    if (!accepted) throw new Error('Сохранение отменено. Назначения специалистов не изменены.')
    try { return await run(token) }
    catch (retryError) { throw new Error((retryError instanceof Error ? retryError.message : String(retryError)).replace(/ \[specialist-confirmation:.*\]/, ' Обновите данные и повторите действие.')) }
  }
}
