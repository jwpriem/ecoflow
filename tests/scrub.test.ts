import { describe, expect, it } from 'vitest'
import { scrubEvent, scrubString, scrubValue } from '../shared/scrub'

describe('scrubbing error reports', () => {
  it('masks emails, bearer tokens, JWTs, keys and secret-looking key=value pairs in text', () => {
    const s = scrubString(
      'Login failed for jeroen@example.com with Authorization: Bearer abc.def.ghi; accessKey=Ak9xQ2 secret: "s3cr3t" ' +
        'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl key Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4cXV1eA== hex 0123456789abcdef0123456789abcdef',
    )
    for (const leaked of ['jeroen@example.com', 'abc.def.ghi', 'Ak9xQ2', 's3cr3t', 'eyJhbGci', 'Zm9vYmFy', '0123456789abcdef0123']) expect(s).not.toContain(leaked)
    expect(s).toContain('[email]')
    expect(s).toContain('Authorization: [redacted]')
    expect(scrubString('Bearer abc.def')).toBe('Bearer [redacted]')
  })

  it('keeps what an error needs to be useful', () => {
    const s = 'Tibber HTTP 503 at /api/plan (site 12), ECONNRESET in /workspace/.output/server/chunks/nitro/nitro.mjs:120:7'
    expect(scrubString(s)).toBe(s)
    expect(scrubValue({ code: 'ECONNRESET', statusCode: 500 })).toEqual({ code: 'ECONNRESET', statusCode: 500 })
  })

  it('drops secret fields at any depth, by name', () => {
    expect(scrubValue({ a: { password: 'hunter2', creds: [{ token: 't', accessKey: 'k', secretKey: 's', clientSecret: 'c' }] }, siteId: 3 })).toEqual({
      a: { password: '[redacted]', creds: [{ token: '[redacted]', accessKey: '[redacted]', secretKey: '[redacted]', clientSecret: '[redacted]' }] },
      siteId: 3,
    })
  })

  it('cleans a whole event: request body, cookies, auth headers, OAuth code and the user', () => {
    const event = scrubEvent({
      event_id: '0123456789abcdef0123456789abcdef',
      message: 'Sign-in for jeroen@example.com failed',
      user: { id: 7, email: 'jeroen@example.com', ip_address: '81.1.2.3' },
      request: {
        url: 'https://www.wattswise.eu/api/integrations/solaredge/callback?code=AUTHCODE123&state=xyz&site=4',
        query_string: 'code=AUTHCODE123&state=xyz&site=4',
        headers: { Authorization: 'Bearer sessiontoken', Cookie: 'sid=1', 'Content-Type': 'application/json', 'X-Forwarded-For': '81.1.2.3' },
        data: { email: 'jeroen@example.com', password: 'hunter2' },
        cookies: { sid: '1' },
      },
      exception: { values: [{ type: 'Error', value: 'EcoFlow said no for key Ak9xQ2Ak9xQ2Ak9xQ2Ak9xQ2Ak9xQ2Ak9xQ2' }] },
      breadcrumbs: [{ category: 'fetch', data: { url: '/api/auth/login', body: 'password=hunter2' } }],
      contexts: { trace: { trace_id: 'abcdefabcdefabcdefabcdefabcdefab' } },
      tags: { siteId: '4', job: 'collect', provider: 'ecoflow' },
    })
    const json = JSON.stringify(event)
    for (const leaked of ['jeroen@example.com', 'hunter2', 'sessiontoken', 'AUTHCODE123', '81.1.2.3', 'sid=1', 'Ak9xQ2Ak9xQ2']) expect(json).not.toContain(leaked)
    expect(event.user).toEqual({ id: 7 })
    expect(event.request).toEqual({
      url: 'https://www.wattswise.eu/api/integrations/solaredge/callback?code=[redacted]&state=[redacted]&site=4',
      query_string: 'code=[redacted]&state=[redacted]&site=4',
      headers: { 'Content-Type': 'application/json' },
    })
    // Ids Sentry needs stay as they are, and so do the tags
    expect(event.event_id).toBe('0123456789abcdef0123456789abcdef')
    expect(event.contexts).toEqual({ trace: { trace_id: 'abcdefabcdefabcdefabcdefabcdefab' } })
    expect(event.tags).toEqual({ siteId: '4', job: 'collect', provider: 'ecoflow' })
  })
})
