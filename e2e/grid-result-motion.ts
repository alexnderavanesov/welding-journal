import { expect, type Page } from '@playwright/test'

export async function observeGridResults(page: Page, selector: string) {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(selector => {
    const observations: { from: number; to: number; duration: number; samples: number[]; finished: boolean; cancelled: boolean }[] = []
    Object.assign(window, { gridResultObservations: observations })
    const animate = Element.prototype.animate
    Element.prototype.animate = function (...args: Parameters<Element['animate']>) {
      const animation = animate.apply(this, args)
      if (!this.matches(selector)) return animation
      const frames = (animation.effect as KeyframeEffect).getKeyframes()
      const entry = { from: Number(frames[0]?.opacity), to: Number(frames.at(-1)?.opacity), duration: Number(animation.effect!.getTiming().duration), samples: [] as number[], finished: false, cancelled: false }
      observations.push(entry)
      const sample = () => {
        if (animation.playState !== 'running') return
        entry.samples.push(Number(getComputedStyle(this).opacity))
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
      animation.addEventListener('finish', () => { entry.finished = true })
      animation.addEventListener('cancel', () => { entry.cancelled = true })
      return animation
    }
  }, selector)
  const read = () => page.evaluate(() => (window as unknown as { gridResultObservations: { from: number; to: number; duration: number; samples: number[]; finished: boolean; cancelled: boolean }[] }).gridResultObservations)
  return {
    read,
    async completed(count: number) {
      await expect.poll(async () => (await read()).filter(row => row.finished).length).toBe(count)
      const last = (await read()).filter(row => row.finished).at(-1)!
      expect(last.duration).toBeLessThanOrEqual(160)
      expect(last.to).toBe(1)
      expect(last.samples.filter(value => value > last.from && value < 1).length).toBeGreaterThanOrEqual(2)
    },
  }
}
