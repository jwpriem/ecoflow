/**
 * Home Screen app on iOS: the docked tab bar jumped up while a page loaded (night, black-translucent status bar)
 * and came back down once the page was long enough. iOS 26 sizes the viewport without the status bar
 * strip while the page doesn't fill the screen, and docks `position: fixed; bottom: 0` to that shorter edge.
 * So in the Home Screen app the shell is never shorter than the physical screen (--screen-h, see main.css).
 */
export default defineNuxtPlugin(() => {
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
})
