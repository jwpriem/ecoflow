/** The iOS app's bundle id (JER-9) */
export const IOS_BUNDLE_ID = 'app.wattswise.ios'

/**
 * The apple-app-site-association file: tells iOS that the app with this Team ID may open the pages an email links to
 * (verify, reset, invite) instead of Safari. app/utils/appLinks.ts routes them inside the app.
 */
export function appSiteAssociation(teamId: string) {
  return {
    applinks: {
      details: [{ appIDs: [`${teamId}.${IOS_BUNDLE_ID}`], components: ['/verify', '/reset', '/invite'].map((p) => ({ '/': p })) }],
    },
  }
}
