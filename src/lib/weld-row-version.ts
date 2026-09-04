export type WeldRowVersionTarget = {
  id: number
  version: string
}

export type CurrentWeldRowVersion = WeldRowVersionTarget & {
  line?: string | null
  joint?: string | null
}

export function assertCurrentWeldRowVersions({
  targetIds,
  expectedVersions,
  currentVersions,
}: {
  targetIds: readonly number[]
  expectedVersions: readonly WeldRowVersionTarget[]
  currentVersions: readonly CurrentWeldRowVersion[]
}) {
  const uniqueTargetIds = [...new Set(targetIds)]
  const targetIdSet = new Set(uniqueTargetIds)
  const expectedById = new Map<number, string>()

  for (const entry of expectedVersions) {
    const id = Number(entry.id)
    const version = String(entry.version ?? '').trim()
    if (!Number.isInteger(id) || id <= 0 || !version || !targetIdSet.has(id) || expectedById.has(id)) {
      throwFreshReplaceTemplateError()
    }
    expectedById.set(id, version)
  }

  if (expectedById.size !== uniqueTargetIds.length) {
    throwFreshReplaceTemplateError()
  }

  const currentById = new Map(currentVersions.map((entry) => [entry.id, entry]))
  if (currentById.size !== uniqueTargetIds.length) {
    throw new Error(
      'Один или несколько стыков из файла больше не существуют. Ни одна строка не сохранена. Скачайте свежий шаблон и повторите замену данных.',
    )
  }

  for (const id of uniqueTargetIds) {
    const current = currentById.get(id)
    if (!current || expectedById.get(id) !== String(current.version ?? '').trim()) {
      const label = current ? formatWeldRowVersionLabel(current) : `ID ${id}`
      throw new Error(
        `${label} был изменен после скачивания Excel. Ни одна строка не сохранена. Скачайте свежий шаблон и повторите замену данных.`,
      )
    }
  }
}

export function assertCurrentInteractiveWeldRowVersions({
  targetIds,
  expectedVersions,
  currentVersions,
}: {
  targetIds: readonly number[]
  expectedVersions: readonly WeldRowVersionTarget[]
  currentVersions: readonly CurrentWeldRowVersion[]
}) {
  const uniqueTargetIds = [...new Set(targetIds)]
  const targetIdSet = new Set(uniqueTargetIds)
  const expectedById = new Map<number, string>()

  for (const entry of expectedVersions) {
    const id = Number(entry.id)
    const version = String(entry.version ?? '').trim()
    if (!Number.isInteger(id) || id <= 0 || !version || !targetIdSet.has(id) || expectedById.has(id)) {
      throwStaleScreenError()
    }
    expectedById.set(id, version)
  }

  if (expectedById.size !== uniqueTargetIds.length) throwStaleScreenError()

  const currentById = new Map(currentVersions.map((entry) => [entry.id, entry]))
  if (currentById.size !== uniqueTargetIds.length) {
    throw new Error(
      'Один или несколько выбранных стыков больше не существуют. Ничего не сохранено. Обновите отчет и повторите действие.',
    )
  }

  for (const id of uniqueTargetIds) {
    const current = currentById.get(id)
    if (!current || expectedById.get(id) !== String(current.version ?? '').trim()) {
      const label = current ? formatWeldRowVersionLabel(current) : `Запись ID ${id}`
      throw new Error(
        `${label} уже изменен другим пользователем или в другом окне. Ничего не сохранено. Обновите отчет и повторите действие.`,
      )
    }
  }
}

function throwFreshReplaceTemplateError(): never {
  throw new Error(
    'Файл замены данных не содержит актуальные служебные версии строк. Ни одна строка не сохранена. Скачайте свежий шаблон и повторите замену данных.',
  )
}

function throwStaleScreenError(): never {
  throw new Error(
    'Открытые данные устарели или не содержат служебную версию. Ничего не сохранено. Обновите отчет и повторите действие.',
  )
}

function formatWeldRowVersionLabel(entry: CurrentWeldRowVersion) {
  const line = String(entry.line ?? '').trim()
  const joint = String(entry.joint ?? '').trim()
  if (line && joint) return `Стык ${line} · ${joint}`
  if (joint) return `Стык ${joint}`
  return `Запись ID ${entry.id}`
}
