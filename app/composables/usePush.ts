export type PushTopic = 'plan' | 'prices' | 'errors' | 'daily' | 'car'
export type PushState = 'loading' | 'unsupported' | 'install' | 'denied' | 'off' | 'on'

/** The topics; their texts are in m.push.topics */
export const PUSH_TOPICS: readonly PushTopic[] = ['plan', 'prices', 'errors', 'daily', 'car']

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

function keyBytes(base64url: string) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

function sameKey(sub: PushSubscription, key: Uint8Array) {
  const cur = sub.options.applicationServerKey
  if (!cur) return true
  const a = new Uint8Array(cur)
  return a.length === key.length && a.every((v, i) => v === key[i])
}

/** Web Push for this device. On iPhone it only works from the Home Screen app (iOS 16.4+). */
export function usePush() {
  const api = useApi()
  const { locale, m, serverText } = useLocale()
  const state = ref<PushState>('loading')
  const topics = ref<PushTopic[]>([...PUSH_TOPICS])
  const error = ref('')
  const busy = ref(false)
  let sub: PushSubscription | null = null

  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

  async function save() {
    await api('/api/push', { method: 'PUT', body: { subscription: sub!.toJSON(), topics: topics.value, locale: locale.value } })
  }

  async function init() {
    error.value = ''
    if (useRuntimeConfig().public.apiBase) return (state.value = 'unsupported')
    if (!supported()) return (state.value = isIos() && !isStandalone() ? 'install' : 'unsupported')
    if (Notification.permission === 'denied') return (state.value = 'denied')
    const reg = await navigator.serviceWorker.ready
    sub = await reg.pushManager.getSubscription()
    const r = await api<{ publicKey: string; subscribed: boolean; topics: PushTopic[] | null }>('/api/push', { query: { endpoint: sub?.endpoint } })
    if (sub && !sameKey(sub, keyBytes(r.publicKey))) {
      // The server's key changed: this subscription can no longer be used
      await sub.unsubscribe().catch(() => undefined)
      sub = null
    }
    if (!sub || Notification.permission !== 'granted') return (state.value = 'off')
    if (r.topics) topics.value = r.topics
    // Subscribed here but unknown to the server (e.g. removed after an error): register it again
    else await save()
    state.value = 'on'
  }

  /** Must run straight from a tap: iOS only shows the permission prompt for a user gesture. */
  async function enable() {
    error.value = ''
    busy.value = true
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return (state.value = permission === 'denied' ? 'denied' : 'off')
      const reg = await navigator.serviceWorker.ready
      const { publicKey } = await api<{ publicKey: string }>('/api/push')
      sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }))
      await save()
      state.value = 'on'
    } catch (e: any) {
      error.value = serverText(e?.data?.statusMessage) || e?.message || m.value.push.enableFailed
    } finally {
      busy.value = false
    }
  }

  async function disable() {
    error.value = ''
    const endpoint = sub?.endpoint
    await sub?.unsubscribe().catch(() => undefined)
    sub = null
    if (endpoint) await api('/api/push', { method: 'DELETE', query: { endpoint } }).catch(() => undefined)
    if (state.value === 'on') state.value = 'off'
  }

  async function toggleTopic(topic: PushTopic, on: boolean) {
    topics.value = on ? [...new Set([...topics.value, topic])] : topics.value.filter((t) => t !== topic)
    await save()
  }

  async function test() {
    error.value = ''
    busy.value = true
    try {
      await api('/api/push/test', { method: 'POST', body: { endpoint: sub?.endpoint } })
    } catch (e: any) {
      error.value = serverText(e?.data?.statusMessage) || e?.message || m.value.push.testFailed
    } finally {
      busy.value = false
    }
  }

  /** Notifications follow the app's language: tell the server when it changes */
  async function syncLocale() {
    if (state.value === 'on' && sub) await save().catch(() => undefined)
  }

  return { state, topics, error, busy, init, enable, disable, toggleTopic, test, syncLocale, isIos }
}
