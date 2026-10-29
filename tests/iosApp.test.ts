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
})
