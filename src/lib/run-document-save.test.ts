import { beforeEach, expect, it, vi } from 'vitest'
vi.unmock('./user-storage')
import { runDocumentSave, readPendingDocumentSaves, dismissDocumentSave } from './run-document-save'
import { scopedStorageKey, setStorageIdentity } from './user-storage'
import { DOCUMENT_SAVE_ID_HEADER, DOCUMENT_SAVE_RECOVERY_STORAGE, isUncertainDocumentSave } from './document-save-recovery'

beforeEach(() => { sessionStorage.clear(); setStorageIdentity('save-recovery-test') })
it.each([{}, 7, [null, {}, { id: 'broken', operation: 'updateWeldJoints' }]])('ignores malformed stored recovery entries without blocking new saves: %j', async stored => {
  setStorageIdentity(`malformed-recovery-${JSON.stringify(stored)}`)
  sessionStorage.setItem(scopedStorageKey(DOCUMENT_SAVE_RECOVERY_STORAGE), JSON.stringify(stored))
  const save = vi.fn().mockResolvedValue('saved')
  await expect(runDocumentSave('updateWeldJoints', save)).resolves.toBe('saved')
  expect(save).toHaveBeenCalledOnce()
  expect(readPendingDocumentSaves()).toEqual([])
})
it('keeps known uncertain operations when the stored recovery list becomes malformed', async () => {
  setStorageIdentity('malformed-existing-recovery')
  await expect(runDocumentSave('savePstoRepeatWorkflow', async () => { throw new TypeError('Failed to fetch') })).rejects.toThrow()
  const pending = readPendingDocumentSaves()
  sessionStorage.setItem(scopedStorageKey(DOCUMENT_SAVE_RECOVERY_STORAGE), JSON.stringify({}))
  expect(readPendingDocumentSaves()).toEqual(pending)
  await expect(runDocumentSave('updateWeldJoints', async () => 'saved')).resolves.toBe('saved')
  expect(readPendingDocumentSaves()).toEqual(pending)
  dismissDocumentSave(pending[0].id)
})
it('sends an opaque operation id and removes a successful attempt', async () => {
  const save = vi.fn().mockResolvedValue(['saved'])
  expect(await runDocumentSave('updateWeldJoints', save)).toEqual(['saved'])
  expect(save.mock.calls[0][0][DOCUMENT_SAVE_ID_HEADER]).toMatch(/^[\da-f-]{36}$/)
  expect(readPendingDocumentSaves()).toEqual([])
})
it.each([new Error('Не удалось связаться с сервером.', { cause: new TypeError('Failed to fetch') }), new TypeError('Failed to fetch'), new SyntaxError('Unexpected end of JSON input'), new DOMException('Aborted', 'AbortError'), new DOMException('The string did not match the expected pattern.', 'SyntaxError'), new Error('502 Bad Gateway')])('retains transport uncertainty for explicit verification: %s', async error => {
  await expect(runDocumentSave('savePstoRepeatWorkflow', async () => { throw error })).rejects.toThrow()
  expect(readPendingDocumentSaves()).toHaveLength(1)
  const id = readPendingDocumentSaves()[0].id
  dismissDocumentSave(id)
  expect(readPendingDocumentSaves()).toEqual([])
})
it('does not offer recovery after a definite business rejection or expose another account intent', async () => {
  expect(isUncertainDocumentSave(new Error('Дата результата раньше даты заявки.'))).toBe(false)
  await expect(runDocumentSave('updateWeldJoints', async () => { throw new Error('Дата результата раньше даты заявки.') })).rejects.toThrow()
  expect(readPendingDocumentSaves()).toEqual([])
  await expect(runDocumentSave('updateWeldJoints', async () => { throw new TypeError('Failed to fetch') })).rejects.toThrow()
  setStorageIdentity('another-account')
  expect(readPendingDocumentSaves()).toEqual([])
})

it.each(['502', '503', '504'])('does not confuse document number %s with an HTTP failure', number => {
  expect(isUncertainDocumentSave(new Error(`Название «НК-31.10.26-${number}» уже занято`))).toBe(false)
})

it('keeps the uncertain operation when parallel saves succeed or are rejected', async () => {
  setStorageIdentity('parallel-save-recovery-test')
  let complete!: (value: string) => void
  let rejectBusiness!: (error: Error) => void
  const successful = runDocumentSave('updateWeldJoints', () => new Promise<string>(resolve => { complete = resolve }))
  const rejected = runDocumentSave('savePreHeatTreatmentLnkWorkflow', () => new Promise<never>((_resolve, reject) => { rejectBusiness = reject })).catch(error => error)
  await expect(runDocumentSave('savePstoRepeatWorkflow', async () => { throw new TypeError('Failed to fetch') })).rejects.toThrow()
  const uncertain = readPendingDocumentSaves().find(item => item.operation === 'savePstoRepeatWorkflow')!
  expect(readPendingDocumentSaves()).toHaveLength(3)
  complete('saved')
  expect(await successful).toBe('saved')
  expect(readPendingDocumentSaves()).toHaveLength(2)
  rejectBusiness(new Error('Данные стыка изменились. Обновите окно.'))
  expect(await rejected).toBeInstanceOf(Error)
  expect(readPendingDocumentSaves()).toEqual([uncertain])
  dismissDocumentSave(uncertain.id)
})

it('finishes an old account save without discarding the current account recovery', async () => {
  setStorageIdentity('first-inflight-save-account')
  let complete!: () => void
  const first = runDocumentSave('updateWeldJoints', () => new Promise<void>(resolve => { complete = resolve }))
  setStorageIdentity('second-inflight-save-account')
  await expect(runDocumentSave('savePstoRepeatWorkflow', async () => { throw new TypeError('Failed to fetch') })).rejects.toThrow()
  const [second] = readPendingDocumentSaves()
  complete()
  await first
  expect(readPendingDocumentSaves()).toEqual([second])
  dismissDocumentSave(second.id)
  setStorageIdentity('first-inflight-save-account')
  expect(readPendingDocumentSaves()).toEqual([])
})

it('retains and dismisses an uncertain save when browser storage is unavailable', async () => {
  setStorageIdentity('storage-unavailable-save-account')
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
  const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
  try {
    await expect(runDocumentSave('updateWeldJoints', async () => { throw new TypeError('Failed to fetch') })).rejects.toThrow()
    const [pending] = readPendingDocumentSaves()
    expect(pending.operation).toBe('updateWeldJoints')
    dismissDocumentSave(pending.id)
    expect(readPendingDocumentSaves()).toEqual([])
  } finally { get.mockRestore(); set.mockRestore(); remove.mockRestore() }
})
