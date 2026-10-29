import { appSiteAssociation } from '../../lib/appLinks'

// iOS fetches this (through Apple's CDN) to allow the app's Universal Links. Off until NUXT_APPLE_TEAM_ID is set.
export default defineEventHandler((event) => {
  const teamId = String(useRuntimeConfig().appleTeamId || '')
  if (!/^[A-Z0-9]{10}$/.test(teamId)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  setResponseHeader(event, 'content-type', 'application/json')
  setResponseHeader(event, 'cache-control', 'public, max-age=3600')
  return appSiteAssociation(teamId)
})
