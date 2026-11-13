import { describe, expect, it } from 'vitest'
import { initials } from '../app/utils/initials'

describe('initials', () => {
  it('takes the first and last part of the local part', () => {
    expect(initials('j.w.priem@gmail.com')).toBe('JP')
    expect(initials('anna-de-vries@example.nl')).toBe('AV')
    expect(initials('piet_jansen+energie@example.nl')).toBe('PE')
  })
  it('gives one letter for a plain local part', () => {
    expect(initials('jeroen@example.nl')).toBe('J')
  })
  it('skips digits and empty input', () => {
    expect(initials('123.ellen@example.nl')).toBe('E')
    expect(initials('42@example.nl')).toBe('?')
    expect(initials(null)).toBe('?')
  })
})
