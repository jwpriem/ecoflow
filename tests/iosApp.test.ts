import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { linkRoute } from '../app/utils/appLinks'
import { appSiteAssociation, IOS_BUNDLE_ID } from '../server/lib/appLinks'
import config from '../capacitor.config'

describe('iOS app (JER-45)', () => {
  it('uses the bundle id from JER-9 everywhere', () => {
    expect(config.appId).toBe(IOS_BUNDLE_ID)
    const pbx = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8')
    const ids = [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids)).toEqual(new Set([IOS_BUNDLE_ID]))
  })

  it('claims both domains for Universal Links, in every build configuration', () => {
    const ent = readFileSync('ios/App/App/App.entitlements', 'utf8')
    expect(ent).toContain('applinks:www.wattswise.eu')
    expect(ent).toContain('applinks:wattswise.eu')
    const pbx = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8')
    expect(pbx.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g)).toHaveLength(2)
  })

  it('lets the app open only the pages an email links to', () => {
    expect(appSiteAssociation('ABCDE12345')).toEqual({
      applinks: { details: [{ appIDs: ['ABCDE12345.app.wattswise.ios'], components: [{ '/': '/verify' }, { '/': '/reset' }, { '/': '/invite' }] }] },
    })
  })

  it('routes a Universal Link to the page inside the app, with its token', () => {
    expect(linkRoute('https://www.wattswise.eu/verify?token=a%2Bb')).toBe('/verify?token=a%2Bb')
    expect(linkRoute('https://wattswise.eu/reset?token=x')).toBe('/reset?token=x')
    expect(linkRoute('https://www.wattswise.eu/invite?token=y')).toBe('/invite?token=y')
    // Anything else stays out
    expect(linkRoute('https://www.wattswise.eu/settings')).toBeNull()
    expect(linkRoute('https://evil.example/verify?token=x')).toBeNull()
    expect(linkRoute('https://www.wattswise.eu.evil.example/verify')).toBeNull()
    expect(linkRoute('not a url')).toBeNull()
  })
})
