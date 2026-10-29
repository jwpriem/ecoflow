import type { OnboardingStep } from '#shared/onboarding'

// Token storage is kept behind this composable so the Capacitor build can swap
// localStorage for @capacitor/preferences / secure storage later.
const KEY = 'battery.token'

function readToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export interface Me {
  id: number
  email: string
  role: 'user' | 'admin'
  member: 'owner' | 'member'
  experimental: boolean
  emailVerified: boolean
  /** The steering disclaimer version the owner still has to accept, while WattsWise steers; null otherwise */
  steeringConsentDue: string | null
  site: { id: number; name: string; timezone: string }
  /** The onboarding step the owner is on; null once done, and always for a member */
  onboarding: OnboardingStep | null
}

export function useAuth() {
  const token = useState<string | null>('token', () => (import.meta.client ? readToken() : null))
  const loggedIn = computed(() => !!token.value)
  const me = useState<Me | null>('me', () => null)
  const isAdmin = computed(() => me.value?.role === 'admin')
  /** Zeekr, the Tibber app and the cars: shown only when the household has experimental integrations on */
  const experimental = computed(() => !!me.value?.experimental)

  /** Fetch who is logged in (once, unless forced). */
  async function loadMe(force = false) {
    if (!token.value || (me.value && !force)) return me.value
    me.value = await useApi()<Me>('/api/auth/me')
    return me.value
  }

  function setToken(value: string | null) {
    token.value = value
    me.value = null
    try {
      if (value) localStorage.setItem(KEY, value)
      else localStorage.removeItem(KEY)
    } catch {}
  }

  return { token, loggedIn, setToken, me, isAdmin, experimental, loadMe }
}

export function useApi() {
  const { token, setToken } = useAuth()
  const base = useRuntimeConfig().public.apiBase as string
  return <T>(path: string, opts: Parameters<typeof $fetch>[1] = {}) =>
    $fetch<T>(path, {
      baseURL: base || undefined,
      ...opts,
      headers: { ...(opts.headers as Record<string, string>), ...(token.value ? { Authorization: `Bearer ${token.value}` } : {}) },
      onResponseError({ response }) {
        if (response.status === 401) {
          setToken(null)
          navigateTo('/login')
        }
      },
    }) as Promise<T>
}
