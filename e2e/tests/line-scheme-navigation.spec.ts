import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { withLineProgramFixture } from '../line-program-fixtures'
import { filterSchemeProject } from '../line-scheme-grid'
import { schemeFixtureCleanup } from '../line-scheme-fixtures'

const trackProject = schemeFixtureCleanup(test)

test('СП-08: единый переход в программу с выделением стыка, оба семейства, холодный и повторный', async ({ page }, info) => {
  test.setTimeout(180_000)
  const project = `E2E scheme navigation ${info.project.name} ${info.repeatEachIndex}`
  trackProject(info, project)
  await withLineProgramFixture(async db => {
    for (const [line, type] of [['PIPE', 'С'], ['SUPPORT', 'Т1']]) {
      const joint = line === 'SUPPORT' ? 'ОП-981' : 'F981'
      const id = (await db.query(`insert into line_programs(project_title,subtitle_code,line,category,group_name,weld_control_percent,pvk_control_percent,support_uzk_control_percent,support_pvk_control_percent,psto_assignment)
        values ($1,'NAV',$2,'II','A',100,100,100,100,'unassigned') returning id`, [project, line])).rows[0].id
      // Enough rows to put the navigation target outside the initial viewport.
      await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,officiality,revision_actuality,has_vik,psto_required)
        select $1,$2,'NAV',$3,$5||n,$4,'действующий','актуальная','да','нет' from generate_series(1,70) n`, [id, project, line, type, line === 'SUPPORT' ? 'ОП-' : 'F'])
      const primary = (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,officiality,revision_actuality,weld_date,has_vik,vik_result,has_uzk,has_pvk,psto_required,stamp_1_k)
        values ($1,$2,'NAV',$3,$5,$4,'действующий','актуальная','2026-11-01','да','ремонт','да','да','нет','NAV-01') returning id`, [id, project, line, type, joint])).rows[0].id
      const repair = (await db.query(`insert into weld_joints(line_program_id,project_title,subtitle_code,line,joint,connection_type,officiality,revision_actuality,weld_date,has_vik,vik_result,has_uzk,has_pvk,psto_required,stamp_1_k)
        values ($1,$2,'NAV',$3,$5,$4,'действующий','актуальная','2026-11-02','да','годен','нет','нет','нет','NAV-01') returning id`, [id, project, line, type, `${joint}R1`])).rows[0].id
      await db.query(`insert into weld_joint_program_states(weld_joint_id,kind,physical_root_id,source_row_id)
        values ($1,'primary',$1,null),($2,'repair',$1,$1)`, [primary, repair])
      await db.query(`update weld_joints set vik_request='NAV-VIK-'||id,vik_request_date='2026-11-01',vik_conclusion='NAV-CONCLUSION-'||id,vik_conclusion_date='2026-11-02' where id=any($1::integer[])`, [[primary, repair]])
    }
  })
  const pdf = await PDFDocument.create(); pdf.addPage([842, 595]); const buffer = Buffer.from(await pdf.save())
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/line-schemes')
  for (const line of ['SUPPORT', 'PIPE']) {
    const repairName = line === 'SUPPORT' ? 'ОП-981R1' : 'F981R1'
    for (let attempt = 0; attempt < 2; attempt++) {
      await filterSchemeProject(page, project)
      const registryRow = page.getByRole('row').filter({ hasText: line }).filter({ hasText: project })
      if (attempt === 0) {
        const chooser = page.waitForEvent('filechooser')
        await registryRow.getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
        await (await chooser).setFiles({ name: `${line}.pdf`, mimeType: 'application/pdf', buffer })
        await page.getByRole('dialog', { name: `Файлы и архив линии ${line}`, exact: true }).getByRole('button', { name: 'Загрузить PDF', exact: true }).click()
      } else await registryRow.getByRole('button', { name: line, exact: true }).click()
      const scheme = page.getByRole('dialog', { name: `Схема линии ${line}`, exact: true })
      await expect(scheme.locator('[data-scheme-point-layer="1"]')).toBeVisible()
      await scheme.getByRole('button', { name: 'Открыть поиск стыков схемы', exact: true }).click()
      await scheme.getByRole('textbox', { name: 'Поиск стыков схемы' }).fill(repairName)
      if (attempt === 0) {
        await scheme.getByRole('button', { name: repairName, exact: true }).click()
        await expect(scheme.getByText(`Размещение: ${repairName}`, { exact: false })).toBeVisible()
        await scheme.locator('[data-scheme-point-layer="1"]').click({ position: { x: 190, y: 140 } })
        await scheme.getByRole('button', { name: /^Сохранить/ }).click()
        await expect(scheme.getByRole('button', { name: `${repairName} Лист 1`, exact: true })).toHaveAttribute('data-scheme-placement', 'saved')
      }
      await scheme.getByRole('button', { name: `Открыть картину стыка ${repairName}: проблема состояния`, exact: true }).click()
      const picture = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `Картина стыка ${repairName}`, exact: true }) })
      await picture.getByRole('tab', { name: /^Требует действия/ }).click()
      const task = picture.getByRole('button', { name: 'Показать описание СП-08', exact: true }).locator('..')
      await expect(task).toBeVisible()
      await task.getByRole('button', { name: 'Открыть программу линии', exact: true }).click()
      const program = page.getByTestId('line-program')
      await expect(program.getByRole('button', { name: line === 'SUPPORT' ? 'Опоры' : '100%-ные линии', exact: true })).toHaveAttribute('aria-pressed', 'true')
      const assignments = page.getByRole('dialog', { name: `Назначения · ${line}`, exact: true })
      await expect(program.getByRole('button', { name: 'Все стыки линии', exact: true })).toHaveAttribute('aria-pressed', 'true')
      const joint = program.getByTestId('line-program-readonly-joint').filter({ has: page.getByRole('button', { name: repairName, exact: true }) })
      await expect(joint).toHaveAttribute('data-highlighted', 'true')
      await expect(joint).toBeInViewport().catch(async error => {
        console.log('NAV_GEOMETRY', await joint.evaluate(element => {
          const rect = (el: Element | null) => el ? { top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height, style: el.getAttribute('style') } : null
          const grid = element.closest('[data-program-grid]')!
          return { y: scrollY, height: innerHeight, page: document.documentElement.scrollHeight, row: rect(element), grid: rect(grid), frame: rect(grid.querySelector('.program-grid-frame')), viewport: rect(grid.querySelector('.ag-grid-viewport')), container: rect(grid.querySelector('.ag-grid-scrolling-container')), section: rect(element.closest('section')) }
        }))
        throw error
      })
      await expect(assignments).not.toBeVisible()
      // The operator opens editing explicitly; the navigation itself is read-only.
      await program.getByRole('button', { name: 'Назначения линии', exact: true }).click()
      await expect(assignments).toBeVisible()
      await assignments.getByRole('button', { name: 'Закрыть назначения', exact: true }).click()
      await page.getByRole('button', { name: 'Схемы линий', exact: true }).click()
    }
  }
  expect(errors).toEqual([])
})
