import { linkRoute } from '~/utils/appLinks'
import { isNative, readNativeToken } from '~/utils/native'

// The iOS app only. Runs before the other plugins and the route middleware, so they see the token from the Keychain.
export default defineNuxtPlugin({
  name: 'native',
  enforce: 'pre',
  async setup(nuxtApp) {
    if (!isNative()) return
    const [{ App }, { StatusBar, Style }] = await Promise.all([import('@capacitor/app'), import('@capacitor/status-bar')])

    useAuth().token.value = await readNativeToken()

    // A verify, reset or invite link from an email opens here instead of in Safari, also when it launched the app
    const open = (url: string | undefined) => {
      const route = url && linkRoute(url)
      if (route) nuxtApp.runWithContext(() => navigateTo(route))
    }
    App.addListener('appUrlOpen', ({ url }) => open(url))
    nuxtApp.hook('app:mounted', async () => open((await App.getLaunchUrl())?.url))

    // The status bar text follows the sky (plugins/sky.client.ts): light at night, dark by day. The web app's
    // translucent band (utils/skyBoot.ts) isn't needed here: the style changes along with the sky.
    delete document.documentElement.dataset.statusbar
    const sky = useState<'day' | 'night'>('sky', () => 'day')
    watch(sky, (s) => StatusBar.setStyle({ style: s === 'night' ? Style.Dark : Style.Light }).catch(() => {}), { immediate: true })
  },
})
