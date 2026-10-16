import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptJson, encryptJson, hashPassword, verifyPassword } from '../server/utils/crypto'
import { startOfLocalDay } from '../server/lib/time'

describe('crypto', () => {
  const key = randomBytes(32).toString('base64')
  it('round-trips credentials and rejects tampering', () => {
    const enc = encryptJson({ token: 'abc' }, key)
    expect(enc).not.toContain('abc')
    expect(decryptJson(enc, key)).toEqual({ token: 'abc' })
    const parts = enc.split('.')
    parts[3] = Buffer.from('xxxx').toString('base64')
    expect(() => decryptJson(parts.join('.'), key)).toThrow()
  })
  it('hashes passwords', async () => {
    const h = await hashPassword('secret123')
    expect(await verifyPassword('secret123', h)).toBe(true)
    expect(await verifyPassword('nope', h)).toBe(false)
  })
})

describe('time', () => {
  it('finds local midnight in Amsterdam (summer and winter)', () => {
    expect(startOfLocalDay(new Date('2026-07-01T10:00:00Z'), 'Europe/Amsterdam').toISOString()).toBe('2026-06-30T22:00:00.000Z')
    expect(startOfLocalDay(new Date('2026-12-01T23:30:00Z'), 'Europe/Amsterdam').toISOString()).toBe('2026-12-01T23:00:00.000Z')
  })
})
