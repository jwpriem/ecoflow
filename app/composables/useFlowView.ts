export type FlowView = 'clean' | 'detailed'

// Same key as before, so the default someone picked in the old Settings section carries over
const KEY_VIEW = 'energyFlow.defaultView'
const KEY_ANIMATE = 'energyFlow.animate'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode or storage blocked: the choice still holds for this session
  }
}

/**
 * How the Energy flow card looks. Stored on this device (it's a display preference): the view
 * last picked on the card opens next time, and whether the flow lines move.
 */
export function useFlowView() {
  const stored = useState<FlowView>('flow-view', () => (read(KEY_VIEW) === 'detailed' ? 'detailed' : 'clean'))
  const animate = useState<boolean>('flow-animate', () => read(KEY_ANIMATE) !== 'off')

  const view = computed<FlowView>({
    get: () => stored.value,
    set: (v) => {
      stored.value = v
      write(KEY_VIEW, v)
    },
  })

  function setAnimate(on: boolean) {
    animate.value = on
    write(KEY_ANIMATE, on ? 'on' : 'off')
  }

  return { view, animate, setAnimate }
}
