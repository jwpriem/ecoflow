import { createDecipheriv, generateKeyPairSync, privateDecrypt, constants } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { appSignatureHeaders, encryptPassword, encryptVin, hmacHeaders } from '../server/providers/zeekr/sign'

const DATE = new Date('2026-10-25T11:50:00Z')

describe('Zeekr HMAC signing', () => {
  it('sets the GMT date and the five HMAC headers', () => {
    const h = hmacHeaders('GET', 'https://host/overseas-app/region/url', '', 'ACCESS', 'SECRET', DATE)
    expect(h['X-DATE']).toBe('Sun, 25 Oct 2026 11:50:00 GMT')
    expect(h['X-HMAC-ALGORITHM']).toBe('hmac-sha256')
    expect(h['X-HMAC-ACCESS-KEY']).toBe('ACCESS')
    expect(h['X-HMAC-SIGNATURE']).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(h['X-HMAC-DIGEST']).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('is deterministic for a fixed date and changes with the path', () => {
    const a = hmacHeaders('GET', 'https://host/a', '', 'K', 'S', DATE)
    const b = hmacHeaders('GET', 'https://host/a', '', 'K', 'S', DATE)
    const c = hmacHeaders('GET', 'https://host/b', '', 'K', 'S', DATE)
    expect(a['X-HMAC-SIGNATURE']).toBe(b['X-HMAC-SIGNATURE'])
    expect(a['X-HMAC-SIGNATURE']).not.toBe(c['X-HMAC-SIGNATURE'])
  })

  it('digests the body', () => {
    const empty = hmacHeaders('POST', 'https://host/x', '', 'K', 'S', DATE)
    const withBody = hmacHeaders('POST', 'https://host/x', '{"a":1}', 'K', 'S', DATE)
    expect(empty['X-HMAC-DIGEST']).not.toBe(withBody['X-HMAC-DIGEST'])
  })
})

describe('Zeekr app signature', () => {
  const headers = { 'Content-Type': 'application/json; charset=UTF-8', authorization: 'bearer-token', 'X-APP-ID': 'ZEEKRCNCH001M0001' }

  it('fills in the nonce and timestamp and adds X-SIGNATURE', () => {
    const out = appSignatureHeaders('GET', 'https://host/veh/list?needSharedCar=true', headers, undefined, 'PROD', 'fixed-nonce', 1700000000000)
    expect(out['X-API-SIGNATURE-NONCE']).toBe('fixed-nonce')
    expect(out['X-TIMESTAMP']).toBe('1700000000000')
    expect(out['X-SIGNATURE']).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('changes the signature when the JSON body changes', () => {
    const a = appSignatureHeaders('POST', 'https://host/login', headers, '{"b":2,"a":1}', 'PROD', 'n', 1)
    const b = appSignatureHeaders('POST', 'https://host/login', headers, '{"a":1,"b":2}', 'PROD', 'n', 1)
    const c = appSignatureHeaders('POST', 'https://host/login', headers, '{"a":1,"b":3}', 'PROD', 'n', 1)
    // key order does not matter (canonicalised), the values do
    expect(a['X-SIGNATURE']).toBe(b['X-SIGNATURE'])
    expect(a['X-SIGNATURE']).not.toBe(c['X-SIGNATURE'])
  })

  it('leaves an empty authorization header out of the signature', () => {
    const withAuth = appSignatureHeaders('GET', 'https://host/x', { ...headers, authorization: 'tok' }, undefined, 'PROD', 'n', 1)
    const noAuth = appSignatureHeaders('GET', 'https://host/x', { ...headers, authorization: '' }, undefined, 'PROD', 'n', 1)
    expect(withAuth['X-SIGNATURE']).not.toBe(noAuth['X-SIGNATURE'])
  })
})

describe('Zeekr field crypto', () => {
  it('encrypts the VIN with AES-128-CBC using the key and IV as raw bytes', () => {
    const key = '0123456789abcdef'
    const iv = 'fedcba9876543210'
    const vin = 'LZEKR0012345ABCDE'
    const enc = encryptVin(vin, key, iv)
    const decipher = createDecipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'))
    const dec = Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8')
    expect(dec).toBe(vin)
  })

  it('encrypts the login password so the private key can recover it', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const spkiB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
    const enc = encryptPassword('hunter2', spkiB64)
    const dec = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(enc, 'base64')).toString('utf8')
    expect(dec).toBe('hunter2')
  })
})
