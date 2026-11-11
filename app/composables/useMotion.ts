/** True when the user asked the OS to reduce motion. Everything animated checks this. */
export function useReducedMotion() {
  const reduced = ref(false)
  onMounted(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reduced.value = mq.matches
    mq.addEventListener('change', (e) => (reduced.value = e.matches))
  })
  return reduced
}

/** A number that springs to its new value (critically damped), for counters and ring sweeps. */
export function useTweened(source: () => number, opts: { stiffness?: number; delay?: number } = {}) {
  const value = ref(0)
  const reduced = useReducedMotion()
  let raf = 0
  let v = 0
  let vel = 0
  const k = opts.stiffness ?? 90
  const c = 2 * Math.sqrt(k)

  function run(target: number) {
    cancelAnimationFrame(raf)
    if (reduced.value || !import.meta.client) {
      value.value = target
      v = target
      return
    }
    let last = performance.now()
    const step = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      vel += (k * (target - v) - c * vel) * dt
      v += vel * dt
      if (Math.abs(target - v) < 1e-4 && Math.abs(vel) < 1e-3) {
        value.value = target
        v = target
        vel = 0
        return
      }
      value.value = v
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  }

  // `delay` (ms) holds the first run back, so a figure that fades in with its section is seen counting
  let wait: ReturnType<typeof setTimeout> | undefined
  onMounted(() => {
    if (opts.delay && !reduced.value) wait = setTimeout(() => run(source()), opts.delay)
    else run(source())
  })
  watch(source, (target) => {
    clearTimeout(wait)
    run(target)
  })
  onBeforeUnmount(() => {
    clearTimeout(wait)
    cancelAnimationFrame(raf)
  })
  return value
}

/** A charge level filling up from empty: slow enough to read, and it waits for its section to fade in. */
export const RISE = { stiffness: 22, delay: 180 } as const
