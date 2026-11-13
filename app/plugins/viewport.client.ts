/**
 * Home Screen app on iOS: the docked tab bar jumped up while a page loaded (night, black-translucent status bar)
 * and came back down once the page was long enough. iOS 26 seems to size the viewport without the status bar
 * strip while the page doesn't fill the screen, and docks `position: fixed; bottom: 0` to that shorter edge.
 * So in the Home Screen app the shell is never shorter than the physical screen (--screen-h, see main.css).
 *
 * TEMPORARY: for an admin, each tab switch also sends what the viewport looked like to /api/admin/viewport,
 * which only logs it. Remove once the jump is confirmed gone.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const nav = navigator as Navigator & { standalone?: boolean }
  // navigator.standalone exists only on iOS: Android's installed app sizes its viewport fine
  if (nav.standalone !== true || useRuntimeConfig().public.apiBase) return
  const html = document.documentElement
  html.classList.add('standalone')

  function screenHeight() {
    // screen.* stays in portrait on iOS; the app is portrait-only, but don't overshoot if it ever turns
    const portrait = matchMedia('(orientation: portrait)').matches
    return portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height)
  }
  const setScreen = () => html.style.setProperty('--screen-h', `${screenHeight()}px`)
  setScreen()
  addEventListener('orientationchange', setScreen)
  addEventListener('resize', setScreen)

  // ---- temporary measurements ----
  const { isAdmin } = useAuth()
  const api = useApi()
  function probe(css: string) {
    const el = document.createElement('div')
    el.style.cssText = `position:fixed;left:-9999px;top:0;width:1px;visibility:hidden;${css}`
    document.body.appendChild(el)
    const cs = getComputedStyle(el)
    const out = { h: el.getBoundingClientRect().height, pt: parseFloat(cs.paddingTop), pb: parseFloat(cs.paddingBottom) }
    el.remove()
    return out
  }
  function measure(when: string) {
    const bar = document.querySelector('nav.tabs')?.getBoundingClientRect()
    const vv = window.visualViewport
    return {
      when,
      path: location.pathname,
      sky: html.dataset.sky,
      statusbar: html.dataset.statusbar ?? 'default',
      screen: [screen.width, screen.height],
      inner: innerHeight,
      client: html.clientHeight,
      scrollH: html.scrollHeight,
      scrollY: Math.round(scrollY),
      vv: vv ? [Math.round(vv.height), Math.round(vv.offsetTop)] : null,
      svh: probe('height:100svh').h,
      lvh: probe('height:100lvh').h,
      dvh: probe('height:100dvh').h,
      vh: probe('height:100vh').h,
      fixedInset: probe('bottom:0').h,
      safe: (({ pt, pb }) => [pt, pb])(probe('height:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)')),
      bar: bar ? [Math.round(bar.top), Math.round(bar.bottom)] : null,
    }
  }
  function send(samples: unknown[]) {
    if (isAdmin.value) api('/api/admin/viewport', { method: 'POST', body: { ua: navigator.userAgent, samples } }).catch(() => undefined)
  }
  let batch: unknown[] = []
  nuxtApp.hook('page:start', () => {
    batch = [measure('start')]
    setTimeout(() => batch.push(measure('start+120ms')), 120)
    setTimeout(() => batch.push(measure('start+400ms')), 400)
  })
  nuxtApp.hook('page:finish', () => {
    setTimeout(() => {
      batch.push(measure('finish+300ms'))
      send(batch)
      batch = []
    }, 300)
  })
  // Also once after launch, when the first page has settled
  nuxtApp.hook('app:mounted', () => {
    setTimeout(() => send([measure('launch+1500ms')]), 1500)
  })
})
