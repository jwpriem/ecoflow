import { describe, expect, it } from 'vitest'
import { SITE_BOOT } from '../app/utils/site'
import { SKY_BOOT } from '../app/utils/skyBoot'
import { BASE_CSP, contentSecurityPolicy, cspMode, inlineScriptHashes } from '../server/lib/csp'
import { createHash } from 'node:crypto'

const sha = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`

describe('content security policy', () => {
  it('allows the boot scripts by hash and nothing inline otherwise', () => {
    const csp = contentSecurityPolicy()
    expect(csp).toContain(sha(SKY_BOOT))
    expect(csp).toContain(sha(SITE_BOOT))
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/)
    expect(csp).toContain(BASE_CSP)
    expect(csp).toContain('report-uri /api/csp-report')
  })

  it('hashes inline scripts and import maps, not JSON data or external scripts', () => {
    const html = `<script>window.a=1</script><script type="application/json" id="d">{"x":1}</script><script src="/x.js"></script><script type="module">import('/y.js')</script><script type="importmap">{"imports":{}}</script>`
    expect(inlineScriptHashes(html)).toEqual([sha('window.a=1'), sha("import('/y.js')"), sha('{"imports":{}}')])
  })

  it('reports by default and only enforces when asked', () => {
    expect(cspMode(undefined)).toBe('report')
    expect(cspMode('enforce')).toBe('enforce')
    expect(cspMode('off')).toBe('off')
    expect(cspMode('nonsense')).toBe('report')
  })
})
