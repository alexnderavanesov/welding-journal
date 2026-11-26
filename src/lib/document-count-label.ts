const countForms = {
  lnkRequest: ['заявку', 'заявки', 'заявок'],
  pstoRequest: ['заявку', 'заявки', 'заявок'],
  lnkConclusion: ['заключение', 'заключения', 'заключений'],
  pstoConclusion: ['диаграмму', 'диаграммы', 'диаграмм'],
  document: ['документ', 'документа', 'документов'],
  joint: ['стык', 'стыка', 'стыков'],
} as const

export function formatDocumentCount(count: number, kind: keyof typeof countForms) {
  const [one, few, many] = countForms[kind]
  const tens = count % 100
  const units = count % 10
  let word: string = many
  if (tens < 11 || tens > 14) {
    if (units === 1) word = one
    else if (units >= 2 && units <= 4) word = few
  }
  return `${count} ${word}`
}
