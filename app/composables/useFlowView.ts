export type FlowView = 'clean' | 'detailed'

const KEY_DEFAULT = 'energyFlow.defaultView'
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
 * How the Energy flow card looks. Stored on this device (it's a display preference, like
 * the iOS Settings app keeps per device): the default view chosen in Settings, whether the
 * flow lines move, and the view picked on the card for the current session.
 */
export function useFlowView() {
  const defaultView = useState<FlowView>('flow-default', () => (read(KEY_DEFAULT) === 'detailed' ? 'detailed' : 'clean'))
  const animate = useState<boolean>('flow-animate', () => read(KEY_ANIMATE) !== 'off')
  // Set when the person switches on the card; cleared when they pick a new default
  const sessionView = useState<FlowView | null>('flow-session', () => null)

  const view = computed<FlowView>({
    get: () => sessionView.value ?? defaultView.value,
    set: (v) => (sessionView.value = v),
  })

  function setDefault(v: FlowView) {
    defaultView.value = v
    sessionView.value = null
    write(KEY_DEFAULT, v)
  }
  function setAnimate(on: boolean) {
    animate.value = on
    write(KEY_ANIMATE, on ? 'on' : 'off')
  }

  return { view, defaultView, animate, setDefault, setAnimate }
}
