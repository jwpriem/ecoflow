// Allow the Capacitor app (capacitor://localhost on iOS, https://localhost on Android) to call the API.
// Auth is a bearer token, not a cookie, so no credentials mode is needed.
const ALLOWED = new Set(['capacitor://localhost', 'https://localhost', 'http://localhost'])

export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/')) return
  const origin = getHeader(event, 'origin')
  if (!origin || !ALLOWED.has(origin)) return
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  })
  if (event.method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return ''
  }
})
