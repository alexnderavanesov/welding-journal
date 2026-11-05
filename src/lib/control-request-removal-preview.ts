export type ControlRequestRemoval = {
  documentId: number
  title: string
  date: string
  positions: string[]
  remaining: number
}

export function formatControlRequestRemovals(removals: readonly ControlRequestRemoval[]) {
  return removals.map(item => `Заявка «${item.title}»${item.date ? ` от ${item.date}` : ''}: ${item.positions.join('; ')}. ${item.remaining
    ? `Позиции будут удалены из заявки. Останется позиций: ${item.remaining}.`
    : 'Заявка станет пустой и будет удалена.'}`).join('\n')
}
