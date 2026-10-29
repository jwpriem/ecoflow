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

  describe('native polish (JER-47)', () => {
    const XC = 'ios/App/App/Assets.xcassets'
    // PNG header: width and height at byte 16 and 20, colour type at 25 (2 = RGB, 6 = RGB with alpha)
    const png = (path: string) => {
      const b = readFileSync(path)
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), alpha: b[25] === 4 || b[25] === 6 }
    }

    it('has a 1024 px app icon without alpha (App Store rule)', () => {
      const icon = JSON.parse(readFileSync(`${XC}/AppIcon.appiconset/Contents.json`, 'utf8'))
      expect(icon.images).toEqual([expect.objectContaining({ filename: 'AppIcon.png', size: '1024x1024' })])
      expect(png(`${XC}/AppIcon.appiconset/AppIcon.png`)).toEqual({ width: 1024, height: 1024, alpha: false })
    })

    it('has a launch screen for light and for dark mode', () => {
      const splash = JSON.parse(readFileSync(`${XC}/Splash.imageset/Contents.json`, 'utf8'))
      expect(splash.images.map((i: any) => [i.filename, i.appearances?.[0]?.value ?? 'light'])).toEqual([
        ['splash-day.png', 'light'],
        ['splash-night.png', 'dark'],
      ])
      for (const f of ['splash-day.png', 'splash-night.png']) expect(png(`${XC}/Splash.imageset/${f}`)).toMatchObject({ width: 2732, height: 2732 })
    })

    it('includes the haptics plugin in the iOS build', () => {
      expect(readFileSync('ios/App/CapApp-SPM/Package.swift', 'utf8')).toContain('CapacitorHaptics')
    })

    it('keeps the app-only styles and the offline notice from hiding a page', () => {
      expect(readFileSync('app/plugins/native.client.ts', 'utf8')).toContain("classList.add('native')")
      const css = readFileSync('app/assets/main.css', 'utf8')
      expect(css).toContain('main:has(.load-error) .offline-notice { display: none; }')
      // A scoped :global() rule once hid all of <main> instead of only the notice
      expect(readFileSync('app/components/OfflineNotice.vue', 'utf8')).not.toContain(':global(')
    })
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
