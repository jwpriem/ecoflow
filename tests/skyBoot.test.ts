import { afterEach, describe, expect, it, vi } from 'vitest'
import { SKY_BOOT } from '../app/utils/skyBoot'
import { sunPosition } from '../app/utils/sun'

// Runs the inlined boot script against a minimal document and reports what it set
function boot(at: Date) {
  vi.setSystemTime(at)
  const metas: Record<string, string> = {}
  const dataset: Record<string, string> = {}
  const document = {
    documentElement: { dataset },
    createElement: () => {
      const attrs: Record<string, string> = {}
      return { attrs, setAttribute: (k: string, v: string) => (attrs[k] = v) }
    },
    head: { appendChild: (m: { attrs: Record<string, string> }) => (metas[m.attrs.name!] = m.attrs.content!) },
  }
  new Function('document', SKY_BOOT)(document)
  return { sky: dataset.sky, statusbar: dataset.statusbar, style: metas['apple-mobile-web-app-status-bar-style'], theme: metas['theme-color'] }
}

describe('sky boot script', () => {
  afterEach(() => vi.useRealTimers())

  it('agrees with sunPosition every 20 minutes through a year', () => {
    vi.useFakeTimers()
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 20 * 60_000 + 7_000) {
      const expected = sunPosition(new Date(t)).altitude > -6 ? 'day' : 'night'
      expect(boot(new Date(t)).sky, new Date(t).toISOString()).toBe(expected)
    }
  })

  it('launches translucent at night and default by day', () => {
    vi.useFakeTimers()
    expect(boot(new Date('2026-10-21T21:00:00Z'))).toEqual({ sky: 'night', statusbar: 'translucent', style: 'black-translucent', theme: '#16262e' })
    expect(boot(new Date('2026-10-21T11:00:00Z'))).toEqual({ sky: 'day', statusbar: undefined, style: 'default', theme: '#e6ecee' })
  })
})
