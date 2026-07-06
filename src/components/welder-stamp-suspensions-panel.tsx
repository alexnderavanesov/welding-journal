import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { DialogHeader } from '@/components/dialog-header'
import { LargeDialogShell } from '@/components/large-dialog-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatWelderStampSuspensionPeriod, validateWelderStampSuspensionRecord } from '@/lib/welder-stamp-suspensions'
import type { WelderStampSuspensionRecord } from '@/lib/welder-stamp-types'

type WelderStampSuspensionsPanelProps = {
  records: WelderStampSuspensionRecord[]
  stampOptions: string[]
  draft: WelderStampSuspensionRecord
  onDraftChange: (field: keyof WelderStampSuspensionRecord, value: string) => void
  onSave: () => boolean
  onReset: () => void
  onEdit: (record: WelderStampSuspensionRecord) => void
  onDelete: (id: number) => void
}

export function WelderStampSuspensionsPanel({
  records,
  stampOptions,
  draft,
  onDraftChange,
  onSave,
  onReset,
  onEdit,
  onDelete,
}: WelderStampSuspensionsPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const validationReason = validateWelderStampSuspensionRecord(draft)
  const hasDraft = Boolean(draft.naksStamp || draft.suspendedFrom || draft.suspendedTo)
  const isEditing = draft.id > 0 && records.some((record) => record.id === draft.id)
  const availableStampOptions = useMemo(() => {
    const normalizedOptions = stampOptions.map((stamp) => stamp.trim()).filter(Boolean)
    return Array.from(new Set(draft.naksStamp ? [draft.naksStamp, ...normalizedOptions] : normalizedOptions)).sort((left, right) =>
      left.localeCompare(right, 'ru'),
    )
  }, [draft.naksStamp, stampOptions])

  useEffect(() => {
    if (!isEditorOpen) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closeEditor()
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [isEditorOpen])

  function openCreateEditor() {
    onReset()
    setIsOpen(true)
    setIsEditorOpen(true)
  }

  function openEditEditor(record: WelderStampSuspensionRecord) {
    onEdit(record)
    setIsOpen(true)
    setIsEditorOpen(true)
  }

  function closeEditor() {
    setIsEditorOpen(false)
    onReset()
  }

  function saveAndCloseEditor() {
    const saved = onSave()
    if (saved) setIsEditorOpen(false)
    return saved
  }

  return (
    <section className="rounded-md border-2 border-slate-300 bg-slate-50/80 shadow-sm shadow-slate-100">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-100/80"
      >
        <span>
          <span className="block text-sm font-semibold text-slate-900">История отстранений</span>
          <span className="mt-1 block text-sm font-normal text-slate-500">
            Проверяет официальные клейма: дата сварки не должна попадать в период отстранения.
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-slate-500">
          {records.length} записей
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {isOpen ? (
        <div className="border-t border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-3">
            <p className="text-sm text-slate-500">Записи не удаляют клеймо из справочника, а временно запрещают его для официальной сварки.</p>
            <Button type="button" onClick={openCreateEditor} disabled={availableStampOptions.length === 0}>
              <Plus className="mr-2 h-4 w-4" />
              Добавить запись
            </Button>
          </div>

          {availableStampOptions.length === 0 ? (
            <div className="mx-3 mt-3 rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-800">
              Сначала добавьте хотя бы одно Клеймо НАКС в справочник.
            </div>
          ) : null}

          <div className="overflow-hidden p-3">
            <div className="overflow-hidden rounded-md border border-slate-200">
              <table className="w-full table-fixed border-collapse text-sm">
                <thead className="bg-slate-100 text-center text-slate-700">
                  <tr>
                    <th className="w-[28%] border-r border-white px-3 py-3 font-semibold">Клеймо НАКС</th>
                    <th className="border-r border-white px-3 py-3 font-semibold">Период отстранения</th>
                    <th className="w-36 px-3 py-3 font-semibold">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {records.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                        История отстранений пока пустая.
                      </td>
                    </tr>
                  ) : (
                    records.map((record) => (
                      <tr
                        key={record.id}
                        className={`border-t border-slate-200 text-center text-slate-700 ${
                          draft.id === record.id ? 'bg-sky-50/70' : ''
                        }`}
                      >
                        <td className="break-words border-r border-slate-100 px-3 py-3 font-semibold text-slate-900">
                          {record.naksStamp}
                        </td>
                        <td className="break-words border-r border-slate-100 px-3 py-3">
                          {formatWelderStampSuspensionPeriod(record)}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex justify-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              title="Редактировать запись отстранения"
                              onClick={() => openEditEditor(record)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="border-rose-200 text-rose-600 hover:bg-rose-50"
                              title="Удалить запись отстранения"
                              onClick={() => onDelete(record.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {isEditorOpen ? (
        <LargeDialogShell maxWidthClassName="max-w-[560px]" maxHeightClassName="max-h-[88vh]" overlayClassName="z-[90] bg-slate-950/30">
          <DialogHeader
            title={isEditing ? 'Редактирование отстранения' : 'Добавление отстранения'}
            subtitle="Период, в который клеймо нельзя указывать в официальных клеймах стыка."
            onClose={closeEditor}
          />
          <div className="space-y-4 px-5 py-5">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-slate-700">Клеймо НАКС</span>
              <Select
                value={draft.naksStamp}
                onChange={(event) => onDraftChange('naksStamp', event.target.value)}
                disabled={availableStampOptions.length === 0}
              >
                <option value="">Выберите клеймо</option>
                {availableStampOptions.map((stamp) => (
                  <option key={stamp} value={stamp}>
                    {stamp}
                  </option>
                ))}
              </Select>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-slate-700">Отстранен от</span>
                <Input
                  type="date"
                  value={draft.suspendedFrom}
                  onChange={(event) => onDraftChange('suspendedFrom', event.target.value)}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-slate-700">Отстранен до</span>
                <Input
                  type="date"
                  value={draft.suspendedTo}
                  onChange={(event) => onDraftChange('suspendedTo', event.target.value)}
                />
              </label>
            </div>

            <div
              className={`rounded-md border px-3 py-2 text-sm ${
                hasDraft && validationReason
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-sky-100 bg-sky-50 text-sky-800'
              }`}
            >
              {availableStampOptions.length === 0
                ? 'Сначала добавьте хотя бы одно Клеймо НАКС в справочник.'
                : hasDraft && validationReason
                  ? validationReason
                  : 'Если дата «до» не указана, период отстранения считается открытым до сегодняшнего дня.'}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
            <Button type="button" variant="secondary" onClick={closeEditor}>
              Отмена
            </Button>
            <Button type="button" onClick={saveAndCloseEditor} disabled={availableStampOptions.length === 0}>
              {isEditing ? 'Сохранить' : 'Добавить'}
            </Button>
          </div>
        </LargeDialogShell>
      ) : null}
    </section>
  )
}
