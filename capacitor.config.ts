// Capacitor wrapper (phase 5). Install when you get there:
//   npm i @capacitor/core @capacitor/preferences && npm i -D @capacitor/cli
//   npx cap add ios && npx cap add android
// Build the static app against the deployed API, then sync:
//   NUXT_PUBLIC_API_BASE=https://<your-app>.ondigitalocean.app npm run generate:app && npx cap sync
const config = {
  appId: 'nl.priem.battery',
  appName: 'WattsWise',
  webDir: '.output/public',
}

export default config
