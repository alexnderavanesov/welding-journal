import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { APP_BOOTSTRAP_READY_EVENT, APP_BOOTSTRAP_RECOVERY_SCRIPT } from './app-bootstrap-recovery'

beforeEach(() => {
  document.body.innerHTML = '<section id="app-bootstrap-recovery" hidden><button id="app-bootstrap-retry">Повторить</button></section>'
  window.eval(APP_BOOTSTRAP_RECOVERY_SCRIPT)
})
afterEach(() => {
  window.dispatchEvent(new Event(APP_BOOTSTRAP_READY_EVENT))
  document.body.innerHTML = ''
})

function failModule() {
  const script = document.createElement('script')
  script.type = 'module'
  script.src = '/assets/index-missing.js'
  document.body.append(script)
  script.dispatchEvent(new Event('error'))
}

describe('recovery before application startup', () => {
  it('offers an explicit retry when the entry module cannot load, without browser storage', () => {
    failModule()
    expect(document.getElementById('app-bootstrap-recovery')).not.toHaveAttribute('hidden')
    expect(document.getElementById('app-bootstrap-retry')?.onclick).toBeTypeOf('function')
  })
  it('ignores images and unrelated scripts', () => {
    const image = document.createElement('img')
    document.body.append(image)
    image.dispatchEvent(new Event('error'))
    const script = document.createElement('script')
    document.body.append(script)
    script.dispatchEvent(new Event('error'))
    expect(document.getElementById('app-bootstrap-recovery')).toHaveAttribute('hidden')
  })
  it('offers recovery when a delivered application module fails to parse or execute before React starts', () => {
    window.dispatchEvent(new ErrorEvent('error', { filename: new URL('/assets/index-broken.js', location.href).href, message: 'Unexpected token' }))
    expect(document.getElementById('app-bootstrap-recovery')).not.toHaveAttribute('hidden')
    expect(document.getElementById('app-bootstrap-retry')?.onclick).toBeTypeOf('function')
  })
  it.each(['https://unrelated.invalid/assets/script.js', '/unrelated.js', 'http://[', ''])('ignores unrelated execution errors: %s', filename => {
    window.dispatchEvent(new ErrorEvent('error', {filename,message:'Unrelated'}))
    expect(document.getElementById('app-bootstrap-recovery')).toHaveAttribute('hidden')
  })
  it('releases the handler after React starts and leaves later errors to their own screens', () => {
    failModule()
    window.dispatchEvent(new Event(APP_BOOTSTRAP_READY_EVENT))
    failModule()
    expect(document.getElementById('app-bootstrap-recovery')).toHaveAttribute('hidden')
    expect(document.getElementById('app-bootstrap-retry')?.onclick).toBeNull()
  })
})
