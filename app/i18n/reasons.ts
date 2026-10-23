/**
 * The planner (server/lib/strategy.ts) explains each slot in English. These patterns turn those
 * explanations into Dutch; tests/reasons.test.ts checks that every reason it writes has one.
 * A reason without a pattern (an older plan) is shown as it is.
 */
const comma = (s: string) => s.replace(/(\d)\.(\d)/g, '$1,$2')

const NL: [RegExp, string][] = [
  [/^stored energy \(cost €([\d.]+)\) sold at peak$/, 'opgeslagen energie (kostte €$1) ingezet op een piek'],
  [/^store solar \(worth €([\d.-]+) fed in\) for a later peak$/, 'zon opslaan (€$1 waard bij teruglevering) voor een latere piek'],
  [/^peak €([\d.]+), filled with solar earlier$/, 'piek €$1, eerder gevuld met zon'],
  [/^peak €([\d.]+), recharged earlier at €([\d.-]+)$/, 'piek €$1, eerder geladen voor €$2'],
  [/^daily cycle: one of the day's most expensive slots \(€([\d.-]+)\)$/, 'dagcyclus: een van de duurste kwartieren van de dag (€$1)'],
  [/^cheapest slot \(€([\d.-]+)\) to fill the daily cycle$/, 'goedkoopste kwartier (€$1) om de dagcyclus te vullen'],
  [/^cheap slot \(€([\d.-]+)\) to cover later peaks$/, 'goedkoop kwartier (€$1) voor latere pieken'],
  [/^more energy stored than profitable peaks$/, 'meer energie opgeslagen dan er winstgevende pieken zijn'],
  [/^charge from solar, save energy for peaks$/, 'laden met zon, energie bewaren voor pieken'],
]

export function hasReasonTranslation(reason: string) {
  return NL.some(([re]) => re.test(reason))
}

export function translateReason(reason: string | null | undefined, locale: 'en' | 'nl'): string {
  if (!reason || locale === 'en') return reason ?? ''
  for (const [re, nl] of NL) if (re.test(reason)) return comma(reason.replace(re, nl))
  return reason
}
