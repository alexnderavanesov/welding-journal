import { expect, it, vi } from 'vitest'
import { withSpecialistCorrectionConfirmation } from './specialist-correction-confirmation'
const token = 'a'.repeat(64)
const conflict = new Error(`Будут очищены обе роли. [specialist-confirmation:${token}]`)
it('warns before one explicit confirmed retry, never retries cancellation or unrelated errors', async () => {
  const run = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce('saved')
  const confirm = vi.fn().mockResolvedValue(true)
  expect(await withSpecialistCorrectionConfirmation(run, confirm)).toBe('saved')
  expect(run.mock.calls).toEqual([[], [token]])
  expect(confirm.mock.calls[0][0].description).not.toContain(token)
  const cancelled = vi.fn().mockRejectedValue(conflict)
  await expect(withSpecialistCorrectionConfirmation(cancelled, vi.fn().mockResolvedValue(false))).rejects.toThrow('отменено')
  expect(cancelled).toHaveBeenCalledTimes(1)
  await expect(withSpecialistCorrectionConfirmation(vi.fn().mockRejectedValue(new Error('Иная ошибка')), confirm)).rejects.toThrow('Иная ошибка')
  expect(confirm).toHaveBeenCalledTimes(1)
})
