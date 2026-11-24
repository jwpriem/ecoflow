import { createCipheriv, createDecipheriv, createHash, createHmac } from 'node:crypto'

/**
 * The signing and encryption of the Midea SmartHome (formerly MSmartHome) cloud, ported from
 * midea-beautiful-air (github.com/nbogojevic/midea-beautiful-air) and midea-local (github.com/midea-lan/midea-local).
 * The app key, IoT key and HMAC key below are the SmartHome app's own; both libraries publish them.
 */
export const MIDEA_APP = {
  appKey: 'ac21b9f9cbfe4ca5a88562ef25e2b768',
  appId: 1010,
  iotKey: 'meicloud',
  hmacKey: 'PROD_VnoClJI9aikS8dyy',
  /** Used for the fingerprint at the end of each packet to the air conditioner */
  signKey: 'xhdiwjnchekd4d512chdjx5d8e4c394D2D7S',
} as const

const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const md5hex = (s: string) => createHash('md5').update(s, 'utf8').digest('hex')

/** Signature header of every request: HMAC-SHA256 over the IoT key, the JSON body and the random value */
export function signRequest(body: string, random: string): string {
  return createHmac('sha256', MIDEA_APP.hmacKey).update(`${MIDEA_APP.iotKey}${body}${random}`, 'utf8').digest('hex')
}

/** `password` field of the login */
export function encryptPassword(loginId: string, password: string): string {
  return sha256hex(loginId + sha256hex(password) + MIDEA_APP.appKey)
}

/** `iampwd` field of the login */
export function encryptIamPassword(loginId: string, password: string): string {
  return sha256hex(loginId + md5hex(md5hex(password)) + MIDEA_APP.appKey)
}

/** Key and IV derived from the app key, for the account name and the keys in the login answer */
function appKeyIv(): { key: string; iv: string } {
  const h = sha256hex(MIDEA_APP.appKey)
  return { key: h.slice(0, 16), iv: h.slice(16, 32) }
}

/** AES-128 over UTF-8 text with PKCS#7 padding, hex out: CBC with an IV, ECB without */
export function aesEncryptHex(text: string, key: string, iv?: string): string {
  const c = iv ? createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8')) : createCipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null)
  return Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('hex')
}

export function aesDecryptHex(hex: string, key: string, iv?: string): string {
  const d = iv ? createDecipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8')) : createDecipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null)
  return Buffer.concat([d.update(Buffer.from(hex, 'hex')), d.final()]).toString('utf8')
}

/** The account name as the account router wants it (it says on which regional server the account lives) */
export function encryptAccount(account: string): string {
  const { key, iv } = appKeyIv()
  return aesEncryptHex(account, key, iv)
}

/** The key and IV for commands to the appliances, from the accessToken and randomData of the login answer */
export function dataKeys(accessToken: string, randomData: string): { key: string; iv: string } {
  const { key, iv } = appKeyIv()
  return { key: aesDecryptHex(accessToken, key, iv), iv: aesDecryptHex(randomData, key, iv) }
}

/**
 * A fixed device ID per account, as midea-local makes it. Midea counts logged-in devices per account and refuses
 * new ones over its limit (65027), so every login from WattsWise must look like the same device.
 */
export function mideaDeviceId(account: string): string {
  return sha256hex(`Hello, ${account}!`).slice(0, 16)
}

/** Commands travel as comma-separated signed bytes */
export function bytesToCsv(data: Uint8Array): string {
  return Array.from(data, (b) => String(b >= 128 ? b - 256 : b)).join(',')
}

export function csvToBytes(csv: string): Uint8Array {
  return Uint8Array.from(csv.split(',').map((s) => (Number(s) + 256) % 256))
}

/** MD5 over the packet and the sign key: the last 16 bytes of a packet */
export function packetFingerprint(packet: Uint8Array): Uint8Array {
  return createHash('md5').update(packet).update(MIDEA_APP.signKey, 'utf8').digest()
}
