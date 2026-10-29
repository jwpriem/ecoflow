/** The pages an email links to: a Universal Link to one of these opens it inside the app */
const LINKED = ['/verify', '/reset', '/invite']

/** The in-app route for a Universal Link (https://www.wattswise.eu/verify?token=…), or null when it isn't one of ours */
export function linkRoute(url: string): string | null {
  try {
    const u = new URL(url)
    if (!/^(www\.)?wattswise\.eu$/.test(u.hostname)) return null
    return LINKED.includes(u.pathname) ? u.pathname + u.search : null
  } catch {
    return null
  }
}
