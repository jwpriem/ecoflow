import type { CapacitorConfig } from '@capacitor/cli'

// The iOS app (JER-45): the static app build (`npm run ios:build`, see the README) wrapped by Capacitor.
// It talks to the production API (NUXT_PUBLIC_API_BASE); the session token lives in the Keychain (plugins/native.client.ts).
const config: CapacitorConfig = {
  appId: 'app.wattswise.ios',
  appName: 'WattsWise',
  webDir: '.output/public',
  ios: {
    // The page draws under the status bar and home indicator itself (env(safe-area-inset-*) in main.css)
    contentInset: 'never',
    // Before the page has painted: the day canvas, not white
    backgroundColor: '#e6ecee',
  },
}

export default config
