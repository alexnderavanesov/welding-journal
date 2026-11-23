import type { ConfirmAction } from './confirm-action-context'

export const SPECIALIST_CORRECTION_CANCELLED = 'Сохранение отменено. Назначения специалистов не изменены.'

export async function withSpecialistCorrectionConfirmation<T>(run: (confirmation?: string) => Promise<T>, confirm: ConfirmAction): Promise<T> {
  try { return await run() }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const token = message.match(/\[specialist-confirmation:([a-f0-9]{64})\]/)?.[1]
    if (!token) throw error
    const dateChange = message.includes('Изменение даты заключения')
    const accepted = await confirm({ title: dateChange ? 'Изменить удостоверения специалистов?' : 'Очистить специалистов при объединении?', description: message.replace(/ \[specialist-confirmation:.*\]/, ''),
      warning: dateChange ? 'Проверьте новые номера удостоверений перед сохранением.' : 'Сохранённые ФИО, удостоверения и клейма обеих ролей будут убраны только из объединённых заключений.', confirmLabel: dateChange ? 'Подтвердить изменения' : 'Сохранить и очистить роли' })
    if (!accepted) throw new Error(SPECIALIST_CORRECTION_CANCELLED)
    try { return await run(token) }
    catch (retryError) { throw new Error((retryError instanceof Error ? retryError.message : String(retryError)).replace(/ \[specialist-confirmation:.*\]/, ' Обновите данные и повторите действие.')) }
  }
}
