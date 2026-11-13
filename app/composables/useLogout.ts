/** Log out on this device: stop push here, end the session on the server, and go to the login page */
export function useLogout() {
  const api = useApi()
  const { setToken } = useAuth()
  const push = usePush()
  return async function logout() {
    await push.disable().catch(() => undefined)
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    setToken(null)
    await navigateTo('/login')
  }
}
