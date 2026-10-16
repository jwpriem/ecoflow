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

export function useAuth() {
  const token = useState<string | null>('token', () => (import.meta.client ? readToken() : null))
  const loggedIn = computed(() => !!token.value)

  function setToken(value: string | null) {
    token.value = value
    try {
      if (value) localStorage.setItem(KEY, value)
      else localStorage.removeItem(KEY)
    } catch {}
  }

  return { token, loggedIn, setToken }
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
