import { sunPosition } from '~/utils/sun'

// The canvas follows the sun over the house: daylight while the sun is above civil twilight
// (-6°), polder night after that. Rechecked every minute and whenever the app comes back to the front.
const THEME = { day: '#e6ecee', night: '#16262e' } as const

export default defineNuxtPlugin(() => {
  const sky = useState<'day' | 'night'>('sky', () => 'day')
  // The first value was already set before paint by utils/skyBoot.ts
  const meta = document.querySelector('meta[name="theme-color"]') ?? document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }))

  function update() {
    const next = sunPosition(new Date()).altitude > -6 ? 'day' : 'night'
    // Attribute first, so anything that reads CSS variables when `sky` changes (charts) gets the new values
    document.documentElement.dataset.sky = next
    meta.setAttribute('content', THEME[next])
    sky.value = next
  }

  update()
  setInterval(update, 60_000)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && update())
})
