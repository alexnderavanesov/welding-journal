export type GuideTable = {
  columns: string[]
  rows: string[][]
}

export type GuideBlock =
  | { type: 'p'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; title?: string; table: GuideTable }
  | { type: 'flow'; title: string; steps: string[] }
  | { type: 'callout'; title: string; text: string }

export type GuideSection = {
  id: string
  title: string
  summary: string
  tags: string[]
  blocks: GuideBlock[]
}
