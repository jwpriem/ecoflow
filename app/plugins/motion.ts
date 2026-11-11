import type { Directive } from 'vue'

/*
 * v-stagger: the children of a container rise into place one after the other, the way a page settles.
 *
 * Only the direct children move, by 8px, with a short fade, 45ms apart and never longer than about half a
 * second in total. Children that arrive later (the data after the skeleton, a note that appears) rise as
 * their own small batch. A child that holds its own v-stagger leaves the moving to it, so nothing moves
 * twice. Nothing moves when the system asks for reduced motion, and the markup the server rendered stays
 * where it is while the page hydrates.
 *
 *   <div v-stagger>…</div>            starts at the first child
 *   <div v-stagger="3">…</div>        starts three steps late, to follow another column
 *
 * A child with style="--o: n" (the reading order some pages already set) takes step n - 1 instead.
 */

const DURATION = 520
const STEP = 45
const MAX_STEPS = 9
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

const observers = new WeakMap<HTMLElement, MutationObserver>()

function reduced() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function rise(children: Element[], start: number) {
  if (reduced()) return
  let i = start
  for (const el of children) {
    if (!(el instanceof HTMLElement) || el.hasAttribute('data-stagger') || el.querySelector('[data-stagger]')) continue
    // A skeleton is a placeholder and should just be there
    if (el.classList.contains('skeleton') || el.offsetParent === null) continue
    // A page that sets its own reading order (style="--o: n") rises in that order
    const o = parseFloat(el.style.getPropertyValue('--o'))
    const step = Number.isFinite(o) ? start + o - 1 : i
    el.animate(
      [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
      { duration: DURATION, easing: EASE, delay: Math.min(Math.max(step, 0), MAX_STEPS) * STEP, fill: 'backwards' },
    )
    i++
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  const stagger: Directive<HTMLElement, number | undefined> = {
    created(el) {
      el.setAttribute('data-stagger', '')
    },
    mounted(el, binding) {
      const start = binding.value ?? 0
      if (!nuxtApp.isHydrating) rise([...el.children], start)
      const mo = new MutationObserver((records) => {
        const added = records.flatMap((r) => [...r.addedNodes]).filter((n): n is Element => n instanceof Element && n.parentElement === el)
        if (added.length) rise(added, added.length > 1 ? start : 0)
      })
      mo.observe(el, { childList: true })
      observers.set(el, mo)
    },
    beforeUnmount(el) {
      observers.get(el)?.disconnect()
      observers.delete(el)
    },
    getSSRProps() {
      return { 'data-stagger': '' }
    },
  }
  nuxtApp.vueApp.directive('stagger', stagger)
})
