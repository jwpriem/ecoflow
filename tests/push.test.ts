import { describe, expect, it } from 'vitest'
import { dailyMessage, departureAskMessage, integrationErrorMessage, testMessage } from '../server/lib/notifications'
import { sendOptions } from '../server/services/push'

const vapid = { subject: 'mailto:owner@example.com', publicKey: 'pub', privateKey: 'priv' }
const apple = 'https://web.push.apple.com/QGuQyavXutnMH'
const google = 'https://fcm.googleapis.com/fcm/send/abc'
const daily = dailyMessage({ savingNaive: 1.2, dischargedKwh: 3, chargedSolarKwh: 1, chargedGridKwh: 2 })('en')

describe('push headers', () => {
  it.each([
    ['plan', 'plan'],
    ['prices', 'prices'],
    ['daily', daily.tag],
    ['errors', integrationErrorMessage('tibber_app', 'Unauthorized')('en').tag],
    ['car', departureAskMessage('Zeekr', 3)('en').tag],
    [null, testMessage('en').tag],
  ] as const)('sends no Topic to Apple for %s, and the tag as Topic elsewhere', (topic, tag) => {
    const { topic: header, ...rest } = sendOptions(google, topic, tag, vapid)
    expect(sendOptions(apple, topic, tag, vapid)).toEqual(rest)
    expect(header).toBe(tag)
    expect(rest).toEqual({ vapidDetails: vapid, TTL: 6 * 3600, urgency: topic === 'errors' ? 'high' : 'normal' })
  })

  it('treats every Apple push host the same, and cleans the tag for the others', () => {
    expect(sendOptions('https://api.push.apple.com/x', 'daily', 'daily', vapid)).not.toHaveProperty('topic')
    expect(sendOptions('https://notpush.apple.com.example/x', 'daily', 'daily', vapid)).toHaveProperty('topic', 'daily')
    expect(sendOptions(google, 'errors', 'error-tibber.app/with spaces and a very long name', vapid).topic).toBe('error-tibberappwithspacesandaver')
    expect(sendOptions(google, 'plan', undefined, vapid)).not.toHaveProperty('topic')
  })
})
