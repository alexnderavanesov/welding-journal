import { BookOpenText, Calculator } from 'lucide-react'
import { ASSIGNMENT_CALCULATION_TOPICS } from '@/lib/assignment-calculation-guide'

export function AssignmentCalculationRules() {
  return <div className="min-w-0 space-y-5">
    <header className="space-y-2 px-1">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Calculator className="h-5 w-5 text-sky-700" aria-hidden="true" />Назначения и расчёты</h2>
      <p className="max-w-4xl text-sm leading-6 text-slate-600">Как приложение считает объём контроля линии: от процента и клейм до добора, ремонтов и опор. Примеры объясняют действующие правила; данные конкретной линии смотрите в её расчёте.</p>
    </header>
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Темы назначений и расчётов" className="rounded-lg border border-slate-200 bg-white p-3 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto">
        <div className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><BookOpenText className="h-4 w-4" aria-hidden="true" />В этой справке</div>
        <ol className="grid gap-1 sm:grid-cols-2 xl:grid-cols-1">{ASSIGNMENT_CALCULATION_TOPICS.map(topic => <li key={topic.id}><a href={`#assignment-calculation-${topic.id}`} className="block rounded-md px-2 py-2 text-sm leading-5 text-slate-600 outline-none hover:bg-sky-50 hover:text-sky-800 focus-visible:ring-2 focus-visible:ring-sky-400">{topic.title}</a></li>)}</ol>
      </nav>
      <div className="min-w-0 space-y-5">
        {ASSIGNMENT_CALCULATION_TOPICS.map(topic => <section key={topic.id} id={`assignment-calculation-${topic.id}`} aria-labelledby={`assignment-calculation-title-${topic.id}`} className="min-w-0 scroll-mt-20 rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
            <h3 id={`assignment-calculation-title-${topic.id}`} className="text-base font-semibold text-slate-900">{topic.title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-sky-800">{topic.summary}</p>
          </div>
          <div className="space-y-3 px-4 py-4 sm:px-5">
            {topic.paragraphs.map(paragraph => <p key={paragraph} className="text-sm leading-6 text-slate-600">{paragraph}</p>)}
            {topic.table ? <div className="overflow-x-auto rounded-md border border-slate-200" role="region" aria-label={`Примеры: ${topic.title}`} tabIndex={0}>
              <table className="w-full min-w-[32rem] border-collapse text-left text-sm leading-6">
                <caption className="sr-only">{topic.title}</caption>
                <thead className="bg-slate-50 text-slate-700"><tr>{topic.table.headers.map(header => <th key={header} scope="col" className="px-3 py-2.5 font-medium">{header}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">{topic.table.rows.map(row => <tr key={row.join('|')} className="even:bg-slate-50/50">{row.map((cell, index) => index === 0 ? <th key={index} scope="row" className="px-3 py-2.5 align-top font-medium text-slate-800">{cell}</th> : <td key={index} className="px-3 py-2.5 align-top text-slate-600">{cell}</td>)}</tr>)}</tbody>
              </table>
            </div> : null}
          </div>
        </section>)}
      </div>
    </div>
  </div>
}
