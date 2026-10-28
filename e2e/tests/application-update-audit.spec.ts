import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { E2E_DATABASE_URL } from '../database'

test('an open previous build recovers when its unloaded module disappears after an application update', async ({page,request},info) => {
  test.skip(!process.env.AUDIT_OLD_BUILD, 'Requires the preserved previous local build')
  expect(process.env.E2E_USE_PRODUCTION_BUILD).toBe('1')
  expect(info.project.use.baseURL).toBe('http://127.0.0.1:3100')
  test.setTimeout(90_000)
  const oldBuild=resolve(process.env.AUDIT_OLD_BUILD!), oldOrigin='http://127.0.0.1:3117'
  expect(oldBuild).not.toBe(resolve('.output'))
  const oldAssets=await readdir(resolve(oldBuild,'public/assets')),currentAssets=await readdir(resolve('.output/public/assets'))
  const retiredGuide=oldAssets.find(name=>/^user-guide-page-.*\.js$/.test(name))!
  expect(retiredGuide).toBeTruthy()
  expect(currentAssets).not.toContain(retiredGuide)
  // Never reuse or stop another process listening at this test-only port.
  let occupied=false
  try {await request.get(oldOrigin+'/journal',{timeout:1000});occupied=true} catch {}
  expect(occupied).toBe(false)
  const server=spawn(process.execPath,[resolve(oldBuild,'server/index.mjs')],{
    env:{...process.env,DATABASE_URL:E2E_DATABASE_URL,WELDING_ENV_LOADED:'1',HOST:'127.0.0.1',PORT:'3117',NODE_ENV:'production'},
    stdio:['ignore','pipe','pipe'],
  })
  let log='',oldDelivery=true,navigations=0
  const failedOldModules:string[]=[]
  server.stdout?.on('data',chunk=>{log+=chunk})
  server.stderr?.on('data',chunk=>{log+=chunk})
  page.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===page.mainFrame())navigations++})
  page.on('response',r=>{if(r.status()===404&&r.url().includes('/assets/'))failedOldModules.push(new URL(r.url()).pathname)})
  try {
    await expect.poll(async()=>{
      if(server.exitCode!==null) throw new Error('Owned previous-build server exited: '+log.slice(-1000))
      try{return (await request.get(oldOrigin+'/journal',{timeout:1000})).ok()}catch{return false}
    },{timeout:15000}).toBe(true)
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url())
      if(oldDelivery && url.origin==='http://127.0.0.1:3100' && (url.pathname==='/journal'||url.pathname.startsWith('/assets/'))) {
        const response=await request.get(oldOrigin+url.pathname+url.search)
        await route.fulfill({response})
      } else await route.continue()
    })
    await page.goto('/journal')
    await expect(page.getByRole('searchbox',{name:'Быстрый поиск по отчету',exact:true})).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(await page.evaluate(name=>performance.getEntriesByType('resource').some(item=>item.name.endsWith('/'+name)),retiredGuide)).toBe(false)
    // Keep the already running old entry/home modules in the browser. Only
    // delivery switches to the current build, as after removing old assets.
    oldDelivery=false
    await page.getByRole('button',{name:'Руководство пользователя',exact:true}).click()
    await expect.poll(()=>failedOldModules).toContain('/assets/'+retiredGuide)
    await expect.poll(()=>navigations,{timeout:30000}).toBe(2)
    await expect(page.getByRole('heading',{name:'Руководство пользователя',exact:true})).toBeVisible({timeout:30000})
    await expect(page.getByPlaceholder('Например: заявка, клеймо')).toBeVisible()
    expect(navigations).toBe(2)
    await page.waitForTimeout(1000)
    expect(navigations).toBe(2)
    await writeFile(info.outputPath('application-update.json'),JSON.stringify({retiredGuide,failedOldModules,navigations,browser:info.project.name},null,2))
  } finally {
    await page.close()
    if(server.exitCode===null && server.signalCode===null){
      const exited=once(server,'exit')
      server.kill('SIGTERM')
      const timeout=setTimeout(()=>server.kill('SIGKILL'),10_000)
      try {await exited} finally {clearTimeout(timeout)}
    }
    await writeFile(info.outputPath('previous-build-server.log'),log)
  }
})
