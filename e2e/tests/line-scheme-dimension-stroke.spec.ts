import { expect, test } from '@playwright/test'
import { SCHEME_DIMENSION_EXTENT, schemeDimensionGeometry } from '../../src/lib/line-scheme-dimensions'

// A dimension extension can be exactly vertical/horizontal as its label moves.
// Check painted pixels (not just a valid SVG path) at and near axis alignment.
test('dimension strokes remain painted near axis alignment in a rotated sheet', async ({ page }, testInfo) => {
  const results: unknown[] = []
  for (const extent of [SCHEME_DIMENSION_EXTENT]) {
    await page.setContent(`<div style="position:absolute;left:0;top:0;width:1846.85px;height:2611.4px;transform-origin:0 0;transform:translateY(1846.85px) rotate(270deg)"><svg width="100%" height="100%" viewBox="0 0 ${extent} ${extent}" preserveAspectRatio="none"><g fill="none" stroke="#64748b"><path id="extensions" vector-effect="non-scaling-stroke" stroke-width="1" stroke-dasharray="3 3" /><path id="main" vector-effect="non-scaling-stroke" stroke-width="1.5" /></g></svg></div>`)
    const samples: number[] = []
    for (const delta of [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1]) {
      const geometry = schemeDimensionGeometry({ x: 1-150/1846.85, y: 500/2611.4 }, { x: 1-450/1846.85, y: 502/2611.4 }, { offsetX: 0, offsetY: delta/2611.4 })
      await page.locator('#main').evaluate((element, path) => element.setAttribute('d', path), geometry.main)
      const png = await page.screenshot({ clip: { x: 495, y: 200, width: 20, height: 200 } })
      const count = await page.evaluate(async image => {
        const img = new Image(); img.src = `data:image/png;base64,${image}`; await img.decode()
        const canvas = document.createElement('canvas'); canvas.width=img.width; canvas.height=img.height
        const ctx=canvas.getContext('2d')!; ctx.drawImage(img,0,0)
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data
        let count=0
        for(let i=0;i<pixels.length;i+=4) if(pixels[i]<220 && pixels[i+1]<225) count++
        return count
      }, png.toString('base64'))
      samples.push(count)
    }
    results.push({ extent, samples })
  }
  console.log(JSON.stringify({ dimensionStroke: results }))
  await testInfo.attach('stroke-measurements', { body: JSON.stringify(results), contentType: 'application/json' })
  for (const result of results as { extent: number; samples: number[] }[]) for (const painted of result.samples) expect(painted).toBeGreaterThan(100)
})
