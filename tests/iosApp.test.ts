import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { linkRoute } from '../app/utils/appLinks'
import { appSiteAssociation, IOS_BUNDLE_ID } from '../server/lib/appLinks'
import { APP_SCHEME, appReturnResult, appReturnUrl } from '../shared/appReturn'
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

  describe('SolarEdge sign-in from the app (JER-54)', () => {
    it('brings the result back through the app scheme, errors included', () => {
      const err = 'Sign-in link expired, try again & 100% "sure"'
      expect(appReturnUrl('solaredge', 'ok')).toBe('wattswise://solaredge?result=ok')
      expect(appReturnResult(appReturnUrl('solaredge', 'ok'), 'solaredge')).toBe('ok')
      expect(appReturnResult(appReturnUrl('solaredge', err), 'solaredge')).toBe(err)
      // Another provider, another scheme or no URL at all is not a result
      expect(appReturnResult(appReturnUrl('tibber', 'ok'), 'solaredge')).toBeNull()
      expect(appReturnResult('https://solaredge?result=ok', 'solaredge')).toBeNull()
      expect(appReturnResult('nonsense', 'solaredge')).toBeNull()
    })

    it('sends the app back only when the signed state says the sign-in started there', () => {
      const authorize = readFileSync('server/api/integrations/[provider]/authorize.get.ts', 'utf8')
      expect(authorize).toMatch(/getQuery\(event\)\.app === '1'/)
      const callback = readFileSync('server/api/integrations/[provider]/callback.get.ts', 'utf8')
      const appReturn = callback.indexOf("if (fromState?.app) return sendRedirect(event, appReturnUrl('solaredge'")
      expect(appReturn).toBeGreaterThan(0)
      // After the connection is saved, before the web redirect
      expect(appReturn).toBeGreaterThan(callback.indexOf('recordSolarEdgeCallback(db'))
      expect(appReturn).toBeLessThan(callback.indexOf("const back = site?.onboarding"))
    })

    it('has the native sheet in the app, under the name the web code calls', () => {
      const swift = readFileSync('ios/App/App/WebAuth.swift', 'utf8')
      expect(swift).toContain('public let jsName = "WebAuth"')
      expect(readFileSync('app/utils/native.ts', 'utf8')).toContain("registerPlugin<{ start(o: { url: string; scheme: string }): Promise<{ url?: string }> }>('WebAuth')")
      expect(readFileSync('app/composables/useSolarEdgeSignIn.ts', 'utf8')).toContain('webAuth(url, APP_SCHEME)')
      expect(APP_SCHEME).toBe('wattswise')
      expect(readFileSync('ios/App/App/SceneDelegate.swift', 'utf8')).toContain('rootViewController = AppViewController()')
      const pbx = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8')
      expect(pbx).toMatch(/\/\* WebAuth\.swift in Sources \*\/,/)
    })
  })
})
