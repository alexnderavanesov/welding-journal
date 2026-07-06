import { formatDisplayDate } from '@/lib/date-format'
import { formatDaysLeft } from '@/lib/dispatcher-format'
import type { DispatcherTask } from '@/lib/dispatcher-types'
import {
  REPAIR_FORBIDDEN_BY_DIAMETER_REASON,
  UNOFFICIAL_REJECTED_WITH_COIL_REASON,
} from '@/lib/report-config'
import type { WeldInput } from '@/lib/weld-fields'
import {
  formatWelderStampCompactLabel,
  formatWelderStampDate,
  formatWelderStampFieldKeysInText,
  formatWelderStampTaskLabel,
} from '@/lib/welder-stamp-format'

export function getRepeatedJointTaskTitle(task: DispatcherTask) {
  if (task.kind === 'welder-stamp-expiry') {
    return {
      joint: formatWelderStampCompactLabel(task),
      type: task.expired ? 'Клеймо НАКС просрочено' : 'Срок НАКС заканчивается',
    }
  }
  if (task.kind === 'create') {
    return {
      joint: task.sourceJoint,
      type: isUnofficialDispatcherJoint(task.row) ? 'Создать официальный стык после неофициального' : 'Создать повторный стык',
    }
  }
  if (task.kind === 'coil') return { joint: task.sourceJoint, type: 'Создать катушку' }
  if (task.kind === 'delete') return { joint: task.targetJoint, type: 'Удалить лишний повторный стык' }
  if (task.kind === 'rename') return { joint: task.currentJoint, type: 'Переименовать повторный стык' }
  if (task.kind === 'duplicate-check') return { joint: task.baseJoint, type: 'Возможный дубль' }
  if (task.kind === 'line-consistency') return { joint: task.line, type: task.title }
  if (task.kind === 'percentage-line-control') return { joint: task.line, type: task.title }

  const reason = task.reason ?? ''
  if (reason === 'проверить даты сварки') return { joint: task.sourceJoint, type: 'Проверить даты сварки' }
  if (reason === 'проверить дату сварки и контроля') return { joint: task.sourceJoint, type: 'Проверить дату сварки и контроля' }
  if (reason === REPAIR_FORBIDDEN_BY_DIAMETER_REASON) return { joint: task.sourceJoint, type: 'Проверить ремонт по диаметру' }
  if (reason === 'проверить клеймо') return { joint: task.sourceJoint, type: 'Проверить клеймо' }
  if (reason === 'дозаполнить клейма_1') return { joint: task.sourceJoint, type: 'Дозаполнить клейма_1' }
  if (reason === 'дозаполнить клейма_2') return { joint: task.sourceJoint, type: 'Дозаполнить клейма_2' }
  if (reason === 'дозаполнить дату сварки') return { joint: task.sourceJoint, type: 'Дозаполнить дату сварки' }
  if (reason === 'проверить целостность цепочки') return { joint: task.sourceJoint, type: 'Проверить целостность цепочки' }
  if (reason === 'проверить целостность катушки') return { joint: task.sourceJoint, type: 'Проверить целостность цепочки' }
  if (reason === 'годный стык неофициальный') return { joint: task.sourceJoint, type: 'Годный стык неофициальный' }
  if (reason === 'несколько годных финалов') return { joint: task.sourceJoint, type: 'Несколько годных финалов' }
  if (reason === 'есть продолжение после годного') return { joint: task.sourceJoint, type: 'Лишняя ветка после годного' }
  if (reason === 'есть лишняя ветка после годного') return { joint: task.sourceJoint, type: 'Лишняя ветка после годного' }
  if (reason === UNOFFICIAL_REJECTED_WITH_COIL_REASON) return { joint: task.sourceJoint, type: 'Проверить катушку после смены официальности' }
  if (reason === 'повторный стык уже заварен' || reason === 'повторный стык содержит данные') {
    return { joint: task.sourceJoint, type: 'Проверить цепочку вместо удаления' }
  }
  if (reason === 'исходный стык больше не требует повтора') {
    return { joint: task.sourceJoint, type: 'Создание повторного стыка не требуется' }
  }
  if (reason === 'повторный стык не актуален' || reason === 'лишний по текущим правилам') {
    return { joint: task.sourceJoint, type: 'Повторный стык не по правилу' }
  }
  return { joint: task.sourceJoint, type: 'Проверить цепочку' }
}

export function getRepeatedJointTaskDetails(task: DispatcherTask) {
  if (task.kind === 'welder-stamp-expiry') {
    const validTo = formatWelderStampDate(task.validTo)
    const stampLabel = formatWelderStampTaskLabel(task)
    if (task.expired) {
      return `${stampLabel} просрочено: срок действия закончился ${validTo}. Перенесите клеймо в архив или актуализируйте срок действия.`
    }
    return `${stampLabel}: срок окончания - ${validTo}. До окончания осталось ${formatDaysLeft(task.daysLeft)}. Проверьте, нужно ли продлить срок или подготовить замену.`
  }
  if (task.kind === 'create') {
    const dateText = formatDisplayDate(task.row.weldDate) || '-'
    const officialityText = isUnofficialDispatcherJoint(task.row) ? 'неофициальный' : 'официальный'
    const ruleText = isUnofficialDispatcherJoint(task.row)
      ? 'Так как исходный стык неофициальный, следующий стык создается с тем же номером без системного индекса R/W/Y.'
      : 'Так как исходный стык официальный, следующий стык создается по правилу цепочки с системным индексом R или W.'
    return `Стык ${task.sourceJoint} (${officialityText}) получил негодный результат ${task.methodCode} - ${task.result}${dateText !== '-' ? `, дата сварки ${dateText}` : ''}. ${ruleText} По правилам цепочки нужен следующий стык ${task.targetJoint}, но диспетчер не нашел его в журнале. Создание выполняется только после подтверждения.`
  }
  if (task.kind === 'coil') {
    const dateText = formatDisplayDate(task.row.weldDate) || '-'
    return `По стыку ${task.sourceJoint} достигнут лимит негодных официальных результатов: текущий результат ${task.methodCode} - ${task.result}${dateText !== '-' ? `, дата сварки ${dateText}` : ''}. Вместо очередного повторного стыка требуется катушка: ${task.targetJoints.join(' и ')}.`
  }
  if (task.kind === 'delete') {
    return `Стык ${task.targetJoint} выглядит лишним для текущего состояния цепочки ${task.sourceJoint}. Причина: ${task.reason}. Дата сварки у него не заполнена, поэтому диспетчер может удалить его после подтверждения. Если есть сомнения, сначала открой цепочку.`
  }
  if (task.kind === 'rename') {
    if (task.key.startsWith('rename-orphan-good:')) {
      return `Стык ${task.currentJoint} находится в цепочке, но исходный или предыдущий стык ${task.targetJoint} не найден в журнале. Так как ${task.currentJoint} уже годен, диспетчер предлагает переименовать его в ${task.targetJoint} и сделать актуальным финалом цепочки.`
    }
    return `Стык ${task.currentJoint} больше не соответствует правилам именования этой цепочки. По текущей официальности и результатам контроля ожидается имя ${task.targetJoint}, поэтому диспетчер предлагает переименовать его после проверки.`
  }
  if (task.kind === 'duplicate-check') {
    return `В журнале найдено несколько строк с одинаковыми проектом, шифром, линией и номером стыка ${task.baseJoint}. Спул при этой проверке не учитывается. Проверь, это допустимые записи или лишние дубли.`
  }
  if (task.kind === 'line-consistency') return task.details
  if (task.kind === 'percentage-line-control') return task.details

  if (task.details) return formatDispatcherTaskText(task.details)

  const reason = task.reason ?? 'цепочка изменилась'
  if (reason === 'проверить даты сварки') {
    return `В цепочке ${task.baseJoint} обнаружена дата сварки, которая нарушает последовательность системных шагов R/W/Y. Проверь даты сварки у повторных стыков.`
  }
  if (reason === 'проверить дату сварки и контроля') {
    return `В цепочке ${task.baseJoint} дата контроля или ПСТО оказалась раньше даты сварки. Проверь даты в сварочном журнале, ЛНК и ПСТО.`
  }
  if (reason === REPAIR_FORBIDDEN_BY_DIAMETER_REASON) {
    return `В стыке ${task.sourceJoint} указан результат "ремонт" при диаметре до 89 мм. По правилу для такого диаметра допустим только "вырез". Проверь D1/D2 или результат контроля.`
  }
  if (reason === 'проверить клеймо') {
    return `В стыке ${task.sourceJoint} найдено несоответствие официального клейма. Проверь реестр клейм, историю отстранений, дату сварки, тип сварки или D1/D2.`
  }
  if (reason === UNOFFICIAL_REJECTED_WITH_COIL_REASON) {
    return `В цепочке ${task.baseJoint} изменилась официальность стыка, из-за чего катушка или ветка может стать лишней либо требовать подтверждения. Проверь цепочку перед дальнейшими действиями.`
  }
  if (reason === 'есть продолжение после годного') {
    return `После годного официального стыка в цепочке ${task.baseJoint} найдено продолжение с более поздней датой сварки. Проверь, не остались ли лишние стыки после финального годного.`
  }
  if (reason === 'есть лишняя ветка после годного') {
    return `В цепочке ${task.baseJoint} есть ветка, которая выглядит лишней после уже полученного годного официального стыка. Открой цепочку и проверь, какие стыки нужно оставить.`
  }
  if (reason === 'несколько годных финалов') {
    return `В цепочке ${task.baseJoint} найдено несколько годных официальных финалов. Нужно проверить, какой стык является актуальным завершением цепочки.`
  }
  if (reason === 'годный стык неофициальный') {
    return `Стык ${task.sourceJoint} имеет годный результат, но отмечен как неофициальный. Итогом цепочки должен быть годный официальный стык, поэтому диспетчер просит проверить цепочку.`
  }
  if (reason === 'проверить целостность цепочки') {
    return `В цепочке ${task.baseJoint} найден повторный стык без исходного или промежуточного стыка. Проверь, не был ли удален базовый или предыдущий шаг цепочки.`
  }
  if (reason === 'проверить целостность катушки') {
    return `В цепочке ${task.baseJoint} найдено нарушение по катушке Y. Проверь, есть ли оба стыка катушки и был ли уже получен негодный результат на стыке, который должен был породить катушку.`
  }
  return `Диспетчер обнаружил нестандартное состояние цепочки ${task.baseJoint}: ${reason}. Открой цепочку и проверь, нужны ли дополнительные действия.`
}

export function getRepeatedJointTaskDetailsHeading(task: DispatcherTask) {
  if (task.kind === 'welder-stamp-expiry') {
    return `${formatWelderStampTaskLabel(task)} · срок окончания ${formatWelderStampDate(task.validTo)}`
  }
  if (task.kind === 'create') return `${formatRepeatedJointTaskHeadingJoint(task.sourceJoint, task.row)} → ${task.targetJoint} · ${task.methodCode} - ${task.result}`
  if (task.kind === 'coil') return `${formatRepeatedJointTaskHeadingJoint(task.sourceJoint, task.row)} · ${task.methodCode} - ${task.result} · катушка ${task.targetJoints.join(' + ')}`
  if (task.kind === 'delete') {
    return `${formatRepeatedJointTaskHeadingJoint(task.sourceJoint, task.sourceRow)} · ${task.reason} · удалить ${formatRepeatedJointTaskHeadingJoint(task.targetJoint, task.row)}`
  }
  if (task.kind === 'rename') return `${formatRepeatedJointTaskHeadingJoint(task.currentJoint, task.row)} → ${task.targetJoint}`
  if (task.kind === 'duplicate-check') return `${formatRepeatedJointTaskHeadingJoint(task.baseJoint, task.row)} · найдено дублей: ${task.count}`
  if (task.kind === 'line-consistency') return `${task.line} · ${task.title}`
  if (task.kind === 'percentage-line-control') return `${task.line} · клеймо ${task.stamp} · ${task.title}`
  return formatDispatcherTaskText(`${formatRepeatedJointTaskHeadingJoint(task.sourceJoint, task.row)} · ${task.reason ?? 'цепочка изменилась'}`)
}

function formatRepeatedJointTaskHeadingJoint(joint: string, row: WeldInput) {
  return isUnofficialDispatcherJoint(row) ? `${joint} · неофициальный` : joint
}

function formatDispatcherTaskText(value: string) {
  return formatWelderStampFieldKeysInText(value)
}

function isUnofficialDispatcherJoint(row: WeldInput) {
  return String(row.status ?? '').trim().toLowerCase() === 'неофициальный'
}
