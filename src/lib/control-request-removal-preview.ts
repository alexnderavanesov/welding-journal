export type ControlRequestRemoval = {
  documentId: number
  title: string
  date: string
  positions: string[]
  remaining: number
}

export function formatControlRequestRemovals(removals: readonly ControlRequestRemoval[], hiddenRemovalCount = 0) {
  const details = removals.map(item => `Заявка «${item.title}»${item.date ? ` от ${item.date}` : ''}: ${item.positions.join('; ')}. ${item.remaining
    ? `Позиции будут удалены из заявки. Останется позиций: ${item.remaining}.`
    : 'Заявка станет пустой и будет удалена.'}`)
  if (hiddenRemovalCount > 0) details.push('Также будут сняты позиции из заявок, сведения о которых недоступны по вашим правам. Остальные позиции сохранятся; пустые заявки будут удалены.')
  return details.join('\n')
}
