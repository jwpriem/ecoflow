import { APP_SCHEME, appReturnResult } from '#shared/appReturn'

/**
 * Sign in with SolarEdge Connect. On the web the page goes to SolarEdge and comes back with ?solaredge=…, so this never
 * resolves. In the iOS app it runs in Apple's sign-in sheet and resolves with the result: 'ok', an error, or null when
 * the sheet was closed without one (the sign-in may still have finished, so reload either way).
 */
export function useSolarEdgeSignIn() {
  const api = useApi()
  return async function signIn(): Promise<string | null> {
    const native = isNative()
    const { url } = await api<{ url: string }>('/api/integrations/solaredge/authorize', { query: native ? { app: 1 } : {} })
    if (!native) {
      window.location.href = url
      return new Promise(() => {})
    }
    const back = (await webAuth(url, APP_SCHEME)).url
    return back ? appReturnResult(back, 'solaredge') : null
  }
}
