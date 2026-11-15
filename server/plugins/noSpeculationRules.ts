/**
 * Nuxt 4.6 adds speculation rules to pages with noScripts (the website): browsers then prefetch and even
 * prerender every page, the app's own pages included, as soon as a link is hovered. Prerendering an app page
 * runs it in the background, API calls and all, and the inline rules would need their own CSP exception.
 * The website is small and fast without them, so they're taken out, at prerender and at runtime alike.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html) => {
    html.head = html.head.map((chunk) => chunk.replace(/<script type="speculationrules">[\s\S]*?<\/script>/g, ''))
  })
})
