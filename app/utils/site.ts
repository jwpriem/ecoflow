/**
 * The public website: Dutch at /, English under /en. Its texts live here rather than in the app's i18n,
 * because the language comes from the URL (for search engines and links), not from the device.
 */
export type SiteLang = 'nl' | 'en'

export const SITE_URL = 'https://www.wattswise.eu'

/** The site's pages, by key, with their path in each language */
export const SITE_PAGES = {
  home: { nl: '/', en: '/en' },
  how: { nl: '/zo-werkt-het', en: '/en/how-it-works' },
  devices: { nl: '/apparaten', en: '/en/devices' },
  faq: { nl: '/vragen', en: '/en/faq' },
  // Stable: the privacy policy's address goes into App Store Connect
  privacy: { nl: '/privacy', en: '/en/privacy' },
  terms: { nl: '/voorwaarden', en: '/en/terms' },
  steering: { nl: '/stuurverklaring', en: '/en/steering-disclaimer' },
  tibber: { nl: '/hulp/tibber', en: '/en/guides/tibber' },
  ecoflow: { nl: '/hulp/ecoflow', en: '/en/guides/ecoflow' },
  solaredge: { nl: '/hulp/solaredge', en: '/en/guides/solaredge' },
} as const
export type SitePage = keyof typeof SITE_PAGES

export const sitePath = (page: SitePage, lang: SiteLang) => SITE_PAGES[page][lang]

/** The website's pages made from content/legal and content/guides, the same Markdown the app shows */
export const SITE_DOCS = { legal: ['privacy', 'terms', 'steering'], guide: ['tibber', 'ecoflow', 'solaredge'] } as const
export type SiteDoc = (typeof SITE_DOCS)[keyof typeof SITE_DOCS][number]

export const SITE_TEXT = {
  nl: {
    tagline: 'Use your watts wisely',
    nav: {
      login: 'Inloggen',
      start: 'Gratis beginnen',
      otherLang: 'English',
      otherLangLabel: 'Read this page in English',
      pagesLabel: 'Website',
      pages: { how: 'Zo werkt het', devices: 'Apparaten', faq: 'Vragen' },
    },
    footer: {
      privacy: 'Privacybeleid',
      terms: 'Gebruiksvoorwaarden',
      steering: 'Stuurverklaring',
      guides: 'Koppelen',
      contact: 'Contact',
      made: 'Gemaakt in Nederland, voor thuisbatterijen en dynamische stroomprijzen.',
    },
    /** Marks a stand-in until the real screenshots from the demo household are in */
    docs: {
      updated: 'Laatst bijgewerkt',
      privacy: { title: 'Privacybeleid · WattsWise', description: 'Welke gegevens WattsWise verwerkt, waarom, waar ze staan, hoe lang we ze bewaren en wat je rechten zijn.' },
      terms: { title: 'Gebruiksvoorwaarden · WattsWise', description: 'De afspraken voor het gebruik van WattsWise.' },
      steering: { title: 'Stuurverklaring · WattsWise', description: 'Wat er gebeurt als je WattsWise je thuisbatterij laat aansturen, en waar je zelf voor kiest.' },
      tibber: { title: 'Tibber koppelen · WattsWise', description: 'Stap voor stap: zo koppel je Tibber en je Tibber Pulse aan WattsWise.' },
      ecoflow: { title: 'EcoFlow koppelen · WattsWise', description: 'Stap voor stap: zo maak je EcoFlow-sleutels aan en koppel je je STREAM-batterijen aan WattsWise.' },
      solaredge: { title: 'SolarEdge koppelen · WattsWise', description: 'Stap voor stap: zo koppel je je SolarEdge-omvormer aan WattsWise.' },
    },
    shot: { mark: 'Voorbeeld', note: 'Hier komt een schermafbeelding uit de app.' },
    day: {
      label: 'Voorbeelddag: de stroomprijs per kwartier, met de kwartieren waarin de batterij laadt en ontlaadt.',
      caption: 'Een voorbeelddag met kwartierprijzen. WattsWise laadt in de goedkope uren en gebruikt die stroom in de dure.',
      charge: 'Laden',
      discharge: 'Ontladen',
      rest: 'Zelf verbruiken of wachten',
      saved: 'Verschil op deze dag',
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
      shotsHeading: 'Zo ziet het eruit',
      shots: [
        { title: 'Je besparing', text: 'Wat de batterij en de panelen deze maand opleverden, dag voor dag.' },
        { title: 'Het plan voor morgen', text: 'Wanneer de batterij laadt en ontlaadt, zodra de prijzen voor morgen bekend zijn.' },
      ],
      more: { how: 'Lees hoe het werkt', devices: 'Bekijk welke apparaten werken' },
    },
    how: {
      title: 'Zo werkt WattsWise',
      description: 'Koppel Tibber en je EcoFlow STREAM, en WattsWise plant elke dag wanneer je batterij laadt en ontlaadt. Je ziet precies wat het oplevert.',
      heading: 'Zo werkt het',
      lede: 'Je koppelt je accounts één keer. Daarna kijkt WattsWise elke dag naar de prijzen en de zon, en zie jij wat het oplevert.',
      steps: [
        { title: 'Koppel je accounts', text: 'Log in bij Tibber en EcoFlow, en eventueel bij SolarEdge. WattsWise leest je verbruik, je batterij en je opwek. Je sleutels worden versleuteld bewaard.' },
        { title: 'WattsWise kijkt vooruit', text: 'Elke middag komen de prijzen voor morgen binnen. Samen met de zonvoorspelling voor jouw omgeving maakt WattsWise een plan per kwartier.' },
        { title: 'Goedkoop laden, duur gebruiken', text: 'In de goedkoopste kwartieren laadt de batterij uit het net of van je panelen. In de dure uren levert hij die stroom aan je huis.' },
        { title: 'Jij ziet de euro’s', text: 'Elk kwartier rekent WattsWise uit wat je zonder batterij had betaald. Dat verschil zie je per dag, maand en jaar.' },
      ],
      modesHeading: 'Meekijken of laten sturen',
      modesLede: 'Je kiest zelf of WattsWise je batterij aanstuurt. Je kunt dat altijd omzetten in de app.',
      modes: [
        { title: 'Alleen meekijken', text: 'Je batterij werkt zoals hij gewend is. WattsWise stuurt niets, maar laat wel zien wat hij oplevert en wat het plan zou zijn.' },
        { title: 'WattsWise laten sturen', text: 'WattsWise past de reserve van je batterij aan volgens het plan, zodat hij laadt als het goedkoop is. Je kunt het plan altijd tijdelijk overrulen.' },
      ],
      cta: 'Gratis beginnen',
    },
    devices: {
      title: 'Apparaten die werken met WattsWise',
      description: 'WattsWise werkt met Tibber (prijzen en de Pulse), EcoFlow STREAM-batterijen en SolarEdge-omvormers. Meer merken volgen.',
      heading: 'Welke apparaten werken',
      lede: 'WattsWise praat met de cloud van je leverancier en je apparaten. Je hoeft thuis niets te installeren.',
      brands: [
        { name: 'Tibber', guide: 'Zo koppel je Tibber', need: 'Nodig', text: 'Je dynamische stroomprijs per kwartier en, via de Tibber Pulse op je slimme meter, wat je huis op elk moment verbruikt en teruglevert.' },
        { name: 'EcoFlow STREAM', guide: 'Zo koppel je EcoFlow', need: 'Nodig', text: 'WattsWise leest het laadniveau en vermogen van je batterijen, en kan ze aansturen. Meerdere STREAM-units in één systeem werken samen.' },
        { name: 'SolarEdge', guide: 'Zo koppel je SolarEdge', need: 'Optioneel', text: 'Heb je zonnepanelen met een SolarEdge-omvormer, dan telt WattsWise je opwek mee in het plan en in je besparing.' },
      ],
      modelsHeading: 'EcoFlow STREAM-modellen',
      models: ['STREAM Ultra', 'STREAM Ultra X', 'STREAM Pro', 'STREAM AC Pro', 'STREAM AC', 'STREAM Max'],
      moreTitle: 'Meer merken volgen',
      moreText: 'We werken aan meer batterijen en energieleveranciers. Mis je jouw merk? Mail ons, dan weten we wat we als eerste moeten bouwen.',
    },
    faq: {
      title: 'Veelgestelde vragen over WattsWise',
      description: 'Is WattsWise gratis, welke gegevens bewaren jullie, heb ik een Tibber Pulse nodig en wat verandert er als salderen stopt? De antwoorden.',
      heading: 'Vragen',
      items: [
        { q: 'Is WattsWise gratis?', a: 'Ja. Er is geen abonnement en er zijn geen advertenties. Kost het ons later meer dan we kunnen dragen, dan hoor je dat ruim van tevoren.' },
        { q: 'Welke gegevens bewaren jullie?', a: 'Je e-mailadres, de instellingen van je huishouden en je energiegegevens: prijzen, verbruik, batterij en opwek. De sleutels voor je accounts staan versleuteld opgeslagen. Alles staat in de EU, en verwijder je je account, dan is het meteen weg. Het privacybeleid zegt precies wat en waarom.' },
        { q: 'Heb ik een Tibber Pulse nodig?', a: 'Ja, voorlopig wel. Zonder Pulse weet WattsWise niet wat je huis verbruikt en teruglevert, en kan het je besparing niet uitrekenen. Ondersteuning voor andere leveranciers en meters staat op de lijst.' },
        { q: 'Wat gebeurt er als ik sturen uitzet?', a: 'Dan stuurt WattsWise niets meer naar je batterij en werkt die zelfstandig verder in de modus Self-Powered. Je blijft zien wat hij oplevert. Je kunt sturen altijd weer aanzetten.' },
        { q: 'Salderen stopt in 2027. Wat betekent dat?', a: 'Tot 1 januari 2027 valt elke kWh die je teruglevert weg tegen een kWh die je koopt. Daarna krijg je voor teruggeleverde stroom de kale marktprijs, vaak min een vergoeding. Dan loont het meer om je eigen zonnestroom op te slaan en zelf te gebruiken. WattsWise rekent daar al mee.' },
        { q: 'Kan mijn partner ook meekijken?', a: 'Ja. Nodig iemand uit in je huishouden, dan ziet die precies dezelfde cijfers en het plan met eigen inloggegevens.' },
        { q: 'Kan WattsWise mijn batterij kapot maken?', a: 'WattsWise verandert alleen instellingen die je ook in de EcoFlow-app kunt aanpassen, zoals de reserve. De batterij bewaakt zijn eigen grenzen. De stuurverklaring legt uit wat we wel en niet doen.' },
      ],
      still: 'Staat je vraag er niet bij? Mail naar hello@wattswise.eu.',
    },
  },
  en: {
    tagline: 'Use your watts wisely',
    nav: {
      login: 'Log in',
      start: 'Start for free',
      otherLang: 'Nederlands',
      otherLangLabel: 'Lees deze pagina in het Nederlands',
      pagesLabel: 'Website',
      pages: { how: 'How it works', devices: 'Devices', faq: 'FAQ' },
    },
    footer: {
      privacy: 'Privacy policy',
      terms: 'Terms of use',
      steering: 'Steering disclaimer',
      guides: 'Connecting',
      contact: 'Contact',
      made: 'Made in the Netherlands, for home batteries and dynamic electricity prices.',
    },
    docs: {
      updated: 'Last updated',
      privacy: { title: 'Privacy policy · WattsWise', description: 'Which data WattsWise processes, why, where it is kept, for how long, and what your rights are.' },
      terms: { title: 'Terms of use · WattsWise', description: 'The terms for using WattsWise.' },
      steering: { title: 'Steering disclaimer · WattsWise', description: 'What happens when you let WattsWise steer your home battery, and what you remain responsible for.' },
      tibber: { title: 'Connect Tibber · WattsWise', description: 'Step by step: how to connect Tibber and your Tibber Pulse to WattsWise.' },
      ecoflow: { title: 'Connect EcoFlow · WattsWise', description: 'Step by step: how to create EcoFlow keys and connect your STREAM batteries to WattsWise.' },
      solaredge: { title: 'Connect SolarEdge · WattsWise', description: 'Step by step: how to connect your SolarEdge inverter to WattsWise.' },
    },
    shot: { mark: 'Example', note: 'A screenshot from the app goes here.' },
    day: {
      label: 'Example day: the electricity price per quarter hour, with the quarters in which the battery charges and discharges.',
      caption: 'An example day of quarter-hour prices. WattsWise charges in the cheap hours and uses that power in the expensive ones.',
      charge: 'Charge',
      discharge: 'Discharge',
      rest: 'Self-use or wait',
      saved: 'Difference on this day',
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
      shotsHeading: 'What it looks like',
      shots: [
        { title: 'Your savings', text: 'What the battery and the panels earned this month, day by day.' },
        { title: 'Tomorrow’s plan', text: 'When the battery charges and discharges, as soon as tomorrow’s prices are in.' },
      ],
      more: { how: 'Read how it works', devices: 'See which devices work' },
    },
    how: {
      title: 'How WattsWise works',
      description: 'Connect Tibber and your EcoFlow STREAM, and WattsWise plans each day when your battery charges and discharges. You see exactly what it earns.',
      heading: 'How it works',
      lede: 'You connect your accounts once. From then on WattsWise looks at the prices and the sun every day, and you see what it earns.',
      steps: [
        { title: 'Connect your accounts', text: 'Sign in to Tibber and EcoFlow, and SolarEdge if you have it. WattsWise reads your usage, your battery and your solar output. Your keys are stored encrypted.' },
        { title: 'WattsWise looks ahead', text: 'Every afternoon the prices for tomorrow come in. Together with the solar forecast for your area, WattsWise makes a plan for every quarter hour.' },
        { title: 'Charge cheap, use when dear', text: 'In the cheapest quarters the battery charges from the grid or your panels. In the expensive hours it powers your home with that energy.' },
        { title: 'You see the euros', text: 'Every quarter hour WattsWise works out what you would have paid without a battery. You see the difference per day, month and year.' },
      ],
      modesHeading: 'Watch, or let it steer',
      modesLede: 'You decide whether WattsWise steers your battery. You can change that at any time in the app.',
      modes: [
        { title: 'Just watch', text: 'Your battery works as it always has. WattsWise sends nothing, but shows what it earns and what the plan would be.' },
        { title: 'Let WattsWise steer', text: 'WattsWise sets your battery’s reserve according to the plan, so it charges when power is cheap. You can always override the plan for a while.' },
      ],
      cta: 'Start for free',
    },
    devices: {
      title: 'Devices that work with WattsWise',
      description: 'WattsWise works with Tibber (prices and the Pulse), EcoFlow STREAM batteries and SolarEdge inverters. More brands are coming.',
      heading: 'Which devices work',
      lede: 'WattsWise talks to the cloud of your supplier and your devices. There is nothing to install at home.',
      brands: [
        { name: 'Tibber', guide: 'How to connect Tibber', need: 'Required', text: 'Your dynamic electricity price per quarter hour and, through the Tibber Pulse on your smart meter, what your home uses and feeds back at any moment.' },
        { name: 'EcoFlow STREAM', guide: 'How to connect EcoFlow', need: 'Required', text: 'WattsWise reads your batteries’ charge level and power, and can steer them. Several STREAM units in one system work together.' },
        { name: 'SolarEdge', guide: 'How to connect SolarEdge', need: 'Optional', text: 'If your solar panels have a SolarEdge inverter, WattsWise counts your solar output in the plan and in your savings.' },
      ],
      modelsHeading: 'EcoFlow STREAM models',
      models: ['STREAM Ultra', 'STREAM Ultra X', 'STREAM Pro', 'STREAM AC Pro', 'STREAM AC', 'STREAM Max'],
      moreTitle: 'More brands are coming',
      moreText: 'We are working on more batteries and energy suppliers. Missing yours? Email us, so we know what to build first.',
    },
    faq: {
      title: 'WattsWise: frequently asked questions',
      description: 'Is WattsWise free, what data do you store, do I need a Tibber Pulse, and what changes when net metering ends? The answers.',
      heading: 'Questions',
      items: [
        { q: 'Is WattsWise free?', a: 'Yes. There is no subscription and there are no ads. If it ever costs us more than we can carry, you will hear about it well in advance.' },
        { q: 'What data do you store?', a: 'Your email address, your household’s settings and your energy data: prices, usage, battery and solar output. The keys to your accounts are stored encrypted. Everything stays in the EU, and when you delete your account it is gone at once. The privacy policy says exactly what and why.' },
        { q: 'Do I need a Tibber Pulse?', a: 'Yes, for now. Without a Pulse WattsWise cannot see what your home uses and feeds back, so it cannot work out your savings. Support for other suppliers and meters is on the list.' },
        { q: 'What happens if I switch steering off?', a: 'Then WattsWise sends nothing more to your battery, and it carries on by itself in Self-Powered mode. You still see what it earns. You can switch steering back on at any time.' },
        { q: 'Net metering ends in 2027. What does that mean?', a: 'Until 1 January 2027, in the Netherlands each kWh you feed back cancels one you buy. After that you get the bare market price for what you feed back, often minus a fee. Storing your own solar power and using it yourself then pays off more. WattsWise already takes this into account.' },
        { q: 'Can my partner see it too?', a: 'Yes. Invite someone to your household and they see exactly the same figures and the plan, with their own login.' },
        { q: 'Can WattsWise damage my battery?', a: 'WattsWise only changes settings you can also change in the EcoFlow app, such as the reserve. The battery guards its own limits. The steering disclaimer explains what we do and don’t do.' },
      ],
      still: 'Is your question not here? Email hello@wattswise.eu.',
    },
  },
} as const

/**
 * Logged-in visitors and the installed app (Home Screen) skip the website and open the app: they had the
 * app at / before the website moved in. Runs in <head>, before anything is drawn. ?site keeps the website.
 */
export const SITE_BOOT =
  "try{if(!/[?&]site\\b/.test(location.search)&&(localStorage.getItem('battery.token')||matchMedia('(display-mode: standalone)').matches||navigator.standalone))location.replace('/app')}catch(e){}"
