/**
 * How a sign-in on another site (SolarEdge) gets back into the iOS app: the server ends it on wattswise://solaredge?result=…,
 * Apple's sign-in sheet (ios/App/App/WebAuth.swift) closes on that scheme and hands the URL to the app.
 */
export const APP_SCHEME = 'wattswise'

export const appReturnUrl = (provider: string, result: string) => `${APP_SCHEME}://${provider}?result=${encodeURIComponent(result)}`

/** The result ('ok' or an error) from an app return URL, or null when it isn't one for this provider */
export function appReturnResult(url: string, provider: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === `${APP_SCHEME}:` && u.hostname === provider ? u.searchParams.get('result') : null
  } catch {
    return null
  }
}
