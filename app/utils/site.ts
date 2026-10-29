/**
 * The public website: Dutch at /, English under /en. Its texts live here rather than in the app's i18n,
 * because the language comes from the URL (for search engines and links), not from the device.
 */
export type SiteLang = 'nl' | 'en'

export const SITE_URL = 'https://www.wattswise.eu'

/** The site's pages, by key, with their path in each language */
export const SITE_PAGES = {
  home: { nl: '/', en: '/en' },
} as const
export type SitePage = keyof typeof SITE_PAGES

export const sitePath = (page: SitePage, lang: SiteLang) => SITE_PAGES[page][lang]

/** The legal texts, in the visitor's language */
export const legalPath = (doc: 'privacy' | 'terms' | 'steering', lang: SiteLang) => `/legal/${doc}?lang=${lang}`

export const SITE_TEXT = {
  nl: {
    tagline: 'Use your watts wisely',
    nav: { login: 'Inloggen', start: 'Gratis beginnen', otherLang: 'English', otherLangLabel: 'Read this page in English' },
    footer: {
      privacy: 'Privacybeleid',
      terms: 'Gebruiksvoorwaarden',
      steering: 'Stuurverklaring',
      contact: 'Contact',
      made: 'Gemaakt in Nederland, voor thuisbatterijen en dynamische stroomprijzen.',
    },
    home: {
      title: 'WattsWise: zie wat je thuisbatterij bespaart',
      description:
        'WattsWise laat zien wat je thuisbatterij en zonnepanelen opleveren, en laadt ze slim op met de dynamische stroomprijs. Gratis, voor Tibber, EcoFlow STREAM en SolarEdge.',
      heading: 'Zie wat je batterij écht oplevert',
      lede: 'WattsWise rekent elk kwartier uit wat je thuisbatterij bespaart op je dynamische stroomprijs, en kan hem voor je laden als stroom goedkoop is en ontladen als hij duur is.',
      cta: 'Gratis beginnen',
      works: 'Werkt met Tibber, EcoFlow STREAM en SolarEdge',
      points: [
        { title: 'Inzicht in euro’s', text: 'Per dag, maand en jaar: wat je batterij en je panelen je opleveren, uitgerekend met je echte kwartierprijzen.' },
        { title: 'Slim laden', text: 'Laat WattsWise je batterij aansturen op de prijs en de zonvoorspelling. Of kijk alleen mee: jij kiest.' },
        { title: 'Gratis', text: 'Geen abonnement, geen advertenties, geen tracking. Je gegevens blijven in de EU.' },
      ],
    },
  },
  en: {
    tagline: 'Use your watts wisely',
    nav: { login: 'Log in', start: 'Start for free', otherLang: 'Nederlands', otherLangLabel: 'Lees deze pagina in het Nederlands' },
    footer: {
      privacy: 'Privacy policy',
      terms: 'Terms of use',
      steering: 'Steering disclaimer',
      contact: 'Contact',
      made: 'Made in the Netherlands, for home batteries and dynamic electricity prices.',
    },
    home: {
      title: 'WattsWise: see what your home battery saves',
      description:
        'WattsWise shows what your home battery and solar panels earn you, and charges them smartly on the dynamic electricity price. Free, for Tibber, EcoFlow STREAM and SolarEdge.',
      heading: 'See what your battery really earns',
      lede: 'Every quarter of an hour, WattsWise works out what your home battery saves on your dynamic electricity price, and it can charge it when power is cheap and use it when power is dear.',
      cta: 'Start for free',
      works: 'Works with Tibber, EcoFlow STREAM and SolarEdge',
      points: [
        { title: 'Savings in euros', text: 'Per day, month and year: what your battery and your panels earn you, worked out with your real quarter-hour prices.' },
        { title: 'Smart charging', text: 'Let WattsWise steer your battery by the price and the solar forecast. Or just watch: your choice.' },
        { title: 'Free', text: 'No subscription, no ads, no tracking. Your data stays in the EU.' },
      ],
    },
  },
} as const

/**
 * Logged-in visitors and the installed app (Home Screen) skip the website and open the app: they had the
 * app at / before the website moved in. Runs in <head>, before anything is drawn. ?site keeps the website.
 */
export const SITE_BOOT =
  "try{if(!/[?&]site\\b/.test(location.search)&&(localStorage.getItem('battery.token')||matchMedia('(display-mode: standalone)').matches||navigator.standalone))location.replace('/app')}catch(e){}"
