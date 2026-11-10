// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { validateSchemePdf } from './line-scheme-pdf-validation'

const mocked = vi.hoisted(() => ({ fork: vi.fn(), execFile: vi.fn(), readFile: vi.fn() }))
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), fork: mocked.fork, execFile: mocked.execFile }))
vi.mock('node:fs/promises', async original => ({ ...await original<typeof import('node:fs/promises')>(), readFile: mocked.readFile }))

class Child extends EventEmitter {
  pid = 12345
  kill = vi.fn((signal: string) => { queueMicrotask(() => this.emit('close', null, signal)); return true })
  send = vi.fn((_job: unknown, callback: (error: Error | null) => void) => callback(null))
}
let child: Child, exitListeners: number, terminateListeners: number, interruptListeners: number
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(() => {
  vi.useFakeTimers()
  child = new Child(); exitListeners = process.listenerCount('exit')
  terminateListeners = process.listenerCount('SIGTERM'); interruptListeners = process.listenerCount('SIGINT')
  mocked.fork.mockReset().mockReturnValue(child)
  mocked.readFile.mockReset().mockResolvedValue('VmRSS:\t65536 kB\n')
  mocked.execFile.mockReset().mockImplementation((_file, _args, _options, callback) => { queueMicrotask(() => callback(null, '65536\n')); return {} })
})
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0)
  expect(child.listenerCount('message')).toBe(0)
  expect(child.listenerCount('error')).toBe(0)
  expect(child.listenerCount('close')).toBe(0)
  expect(process.listenerCount('exit')).toBe(exitListeners)
  expect(process.listenerCount('SIGTERM')).toBe(terminateListeners)
  expect(process.listenerCount('SIGINT')).toBe(interruptListeners)
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.useRealTimers()
})
async function begin(signal?: AbortSignal) {
  const result = validateSchemePdf('/fixture.pdf', 100 * 1024 * 1024, 100, signal)
    .then(value => ({ value, error: undefined }), (error: Error) => ({ value: undefined, error }))
  await vi.waitFor(() => expect(mocked.fork).toHaveBeenCalledOnce())
  return { result }
}
const success = (peakRssBytes = 64 * 1024 * 1024) => ({ ok: true, pages: 3, peakRssBytes })

it('waits for actual process close and strips inherited server secrets/loaders', async () => {
  const { result } = await begin()
  const [, , options] = mocked.fork.mock.calls[0]
  expect(options.execArgv).toEqual(['--max-old-space-size=256'])
  expect(options.env).toEqual({ LINE_SCHEME_PDF_WORKER: '1', NODE_ENV: 'production' })
  expect(child.send).toHaveBeenCalledWith({ path: '/fixture.pdf', maxBytes: 100 * 1024 * 1024, maxPages: 100 }, expect.any(Function))
  child.emit('message', success())
  let finished = false; void result.then(() => { finished = true })
  await Promise.resolve(); expect(finished).toBe(false)
  child.emit('close', 0, null)
  expect(await result).toEqual({ value: 3, error: undefined })
})
it('rejects a short-lived worker that exceeded RSS before the first sample', async () => {
  const { result } = await begin()
  child.emit('message', success(513 * 1024 * 1024))
  expect((await result).error?.message).toContain('безопасно проверить')
  expect(child.kill).toHaveBeenCalledWith('SIGKILL')
})
it('terminates an unresponsive parser on the existing 120-second deadline', async () => {
  const { result } = await begin()
  await vi.advanceTimersByTimeAsync(120_000)
  expect((await result).error?.message).toContain('слишком много времени')
  expect(child.kill).toHaveBeenCalledWith('SIGKILL')
})
it('kills on caller cancellation and removes its abort subscription', async () => {
  const controller = new AbortController(), remove = vi.spyOn(controller.signal, 'removeEventListener')
  const { result } = await begin(controller.signal)
  controller.abort(new Error('caller cancelled'))
  expect((await result).error?.message).toBe('caller cancelled')
  expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
})
it('does not spawn for an already-cancelled validation', async () => {
  await expect(validateSchemePdf('/fixture.pdf', 1024, 100, AbortSignal.abort())).rejects.toThrow()
  expect(mocked.fork).not.toHaveBeenCalled()
})
it('kills when the OS probe detects external-memory RSS above the budget', async () => {
  mocked.readFile.mockResolvedValue('VmRSS:\t525312 kB\n')
  mocked.execFile.mockImplementation((_file, _args, _options, callback) => { queueMicrotask(() => callback(null, '525312\n')); return {} })
  const { result } = await begin()
  await vi.advanceTimersByTimeAsync(100)
  expect((await result).error?.message).toContain('безопасно проверить')
  expect(child.kill).toHaveBeenCalledWith('SIGKILL')
})
it('fails closed if the OS memory probe is unavailable', async () => {
  mocked.readFile.mockRejectedValue(new Error('permission denied'))
  mocked.execFile.mockImplementation((_file, _args, _options, callback) => { queueMicrotask(() => callback(new Error('permission denied'), '')); return {} })
  const { result } = await begin()
  await vi.advanceTimersByTimeAsync(100)
  expect((await result).error?.message).toContain('Не удалось проверить PDF')
  expect(child.kill).toHaveBeenCalledWith('SIGKILL')
})
it.each([0, 1, null])('rejects exit %s without a validated result', async code => {
  const { result } = await begin()
  child.emit('close', code, code === null ? 'SIGABRT' : null)
  expect((await result).error?.message).toContain('Не удалось проверить PDF')
})
it('maps parser errors without leaking worker filesystem or error details', async () => {
  const { result } = await begin()
  child.emit('message', { ok: false, reason: 'invalid', peakRssBytes: 64 * 1024 * 1024 })
  expect((await result).error?.message).toContain('повреждён или защищён паролем')
})
it('cleans up after a failed fork', async () => {
  mocked.fork.mockImplementation(() => { throw new Error('spawn failed') })
  await expect(validateSchemePdf('/fixture.pdf', 1024, 100)).rejects.toThrow('spawn failed')
})
it('kills and cleans up if IPC send throws synchronously', async () => {
  child.send.mockImplementation(() => { throw new Error('channel closed') })
  const { result } = await begin()
  expect((await result).error?.message).toContain('Не удалось проверить PDF')
  expect(child.kill).toHaveBeenCalledWith('SIGKILL')
})
it('kills and cleans up after an asynchronous child process error', async () => {
  const { result } = await begin()
  child.emit('error', new Error('spawn EPERM'))
  expect((await result).error?.message).toContain('Не удалось проверить PDF')
  expect(child.kill).toHaveBeenCalledWith('SIGKILL')
})
it('reads Linux RSS from proc without starting ps', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  const { result } = await begin()
  await vi.advanceTimersByTimeAsync(100)
  expect(mocked.readFile).toHaveBeenCalledWith('/proc/12345/status', { encoding: 'utf8', signal: expect.any(AbortSignal) })
  expect(mocked.execFile).not.toHaveBeenCalled()
  child.emit('message', success()); child.emit('close', 0, null)
  expect((await result).value).toBe(3)
})
it('accepts an exiting Linux zombie only after its validated result and close', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  mocked.readFile.mockResolvedValue('State:\tZ (zombie)\n')
  const { result } = await begin()
  await vi.advanceTimersByTimeAsync(100)
  expect(child.kill).not.toHaveBeenCalled()
  child.emit('message', success()); child.emit('close', 0, null)
  expect((await result).value).toBe(3)
})
it('fails closed on Linux ENOENT before a result or process exit', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  mocked.readFile.mockRejectedValue(Object.assign(new Error('gone'), { code: 'ENOENT' }))
  const { result } = await begin()
  await vi.advanceTimersByTimeAsync(100)
  expect((await result).error?.message).toContain('Не удалось проверить PDF')
  expect(child.kill).toHaveBeenCalledWith('SIGKILL')
})
it.each(['linux', 'darwin'])('cancels and settles an in-flight %s probe on process close', async platform => {
  Object.defineProperty(process, 'platform', { value: platform })
  let probeAborted = false
  mocked.readFile.mockImplementation((_path, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { probeAborted = true; reject(signal.reason) }, { once: true })
  }))
  mocked.execFile.mockImplementation((_file, _args, { signal }: { signal: AbortSignal }, callback) => {
    signal.addEventListener('abort', () => { probeAborted = true; callback(signal.reason, '') }, { once: true })
    return {}
  })
  const { result } = await begin()
  await vi.advanceTimersByTimeAsync(100)
  child.emit('message', success()); child.emit('close', 0, null)
  expect((await result).value).toBe(3)
  expect(probeAborted).toBe(true)
  expect(child.kill).not.toHaveBeenCalled()
})
